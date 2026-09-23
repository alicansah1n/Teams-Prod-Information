import pLimit from 'p-limit';
import type { AppConfig, ProjectConfig } from '../config.js';
import type { JiraClient } from '../jira/client.js';
import { addComment } from '../jira/comments.js';
import { getVersionIssues, jqlString, searchIssues } from '../jira/issues.js';
import { getProject } from '../jira/projects.js';
import {
  doTransition,
  fieldsForTransition,
  getTransitions,
  missingRequiredFields,
  selectTransition,
  statusMatches,
} from '../jira/transitions.js';
import { toIssueSummary, type IssueSummary } from '../jira/types.js';
import { findVersion, listVersions, updateVersion, versionUrl } from '../jira/versions.js';
import { errorMessage, UserError } from '../util/errors.js';
import { renderTemplate } from '../util/template.js';
import { fileStamp, formatDateTr, formatTimeTr, toIsoDate } from '../util/time.js';
import {
  planBlockers,
  type BlockedIssue,
  type CompletedIssue,
  type FailedIssue,
  type PlannedTransition,
  type ReleasePlan,
  type ReleaseResult,
  type StatusKind,
  type VersionEligibility,
  type VersionSummary,
} from './types.js';

export interface ReleaseServiceDeps {
  jira: JiraClient;
  config: AppConfig;
  now?: () => Date;
  /** Jira'ya aynı anda yapılacak en fazla istek (rate limit'e takılmamak için düşük tutulur) */
  concurrency?: number;
}

export interface ExecuteOptions {
  /** Maddelere yorum eklensin mi (varsayılan: config addComment) */
  comment?: boolean;
  /** Hatalı madde olsa bile release "Released" yapılsın mı */
  releaseWithErrors?: boolean;
}

const DEPLOY_NOTE_PREFIX = 'Canlı çıkış:';
const KIND_ORDER: StatusKind[] = ['source', 'target', 'allowed', 'other'];
const ELIGIBILITY_ORDER: VersionEligibility[] = ['ready', 'blocked', 'empty'];

/** Önizleme ve release listesi aynı kuralı kullansın diye statü sınıflandırması tek yerde. */
export function classifyStatus(status: { id: string; name: string }, pc: ProjectConfig): StatusKind {
  if (statusMatches(status, { name: pc.sourceStatus, id: pc.sourceStatusId })) return 'source';
  if (statusMatches(status, { name: pc.targetStatus, id: pc.targetStatusId })) return 'target';
  if (pc.allowedStatuses.some((name) => statusMatches(status, { name }))) return 'allowed';
  return 'other';
}

/**
 * Tetikleyiciden (CLI, Jenkins, Teams bot) bağımsız iş mantığı.
 * plan() hiçbir şeyi değiştirmez; execute() yalnızca plan'daki maddeleri işler.
 */
export class ReleaseService {
  private readonly jira: JiraClient;
  private readonly config: AppConfig;
  private readonly now: () => Date;
  private readonly concurrency: number;

  constructor(deps: ReleaseServiceDeps) {
    this.jira = deps.jira;
    this.config = deps.config;
    this.now = deps.now ?? (() => new Date());
    this.concurrency = deps.concurrency ?? 3;
  }

  projectConfig(projectKey: string): ProjectConfig {
    return this.config.project(projectKey);
  }

  /**
   * Yayınlanmamış release'ler ve her birinin statü dağılımı (tek JQL sorgusuyla).
   * Uygun olanlar üstte; aynı grup içinde Jira'daki sıra korunur.
   */
  async listVersionSummaries(projectKey: string): Promise<VersionSummary[]> {
    const key = projectKey.toUpperCase();
    const pc = this.config.project(key);
    const versions = (await listVersions(this.jira, key, { status: 'unreleased' })).filter((v) => !v.archived);
    if (versions.length === 0) return [];

    const issues = await searchIssues(
      this.jira,
      `project = ${jqlString(key)} AND fixVersion in unreleasedVersions(${jqlString(key)})`,
      ['fixVersions', 'status'],
    );
    // versionId → statusId → sayaç
    const byVersion = new Map<string, Map<string, { name: string; kind: StatusKind; count: number }>>();
    for (const issue of issues) {
      const { status } = issue.fields;
      for (const v of issue.fields.fixVersions ?? []) {
        const counts = byVersion.get(v.id) ?? new Map();
        const entry = counts.get(status.id) ?? { name: status.name, kind: classifyStatus(status, pc), count: 0 };
        entry.count++;
        counts.set(status.id, entry);
        byVersion.set(v.id, counts);
      }
    }

    const summaries = versions.map((version) => {
      const statuses = [...(byVersion.get(version.id)?.values() ?? [])].sort(
        (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.count - a.count,
      );
      const sum = (kind: StatusKind) => statuses.filter((s) => s.kind === kind).reduce((n, s) => n + s.count, 0);
      const pending = sum('source');
      const done = sum('target');
      const otherCount = sum('other');
      const eligibility: VersionEligibility = otherCount > 0 ? 'blocked' : pending + done > 0 ? 'ready' : 'empty';
      return { version, statuses, total: statuses.reduce((n, s) => n + s.count, 0), pending, done, otherCount, eligibility };
    });
    return summaries.sort((a, b) => ELIGIBILITY_ORDER.indexOf(a.eligibility) - ELIGIBILITY_ORDER.indexOf(b.eligibility));
  }

  async plan(input: { projectKey: string; versionName: string; deployedAt?: Date }): Promise<ReleasePlan> {
    const key = input.projectKey.trim().toUpperCase();
    const pc = this.config.project(key);
    const target = { name: pc.targetStatus, id: pc.targetStatusId };

    const project = await getProject(this.jira, key);
    const version = await findVersion(this.jira, key, input.versionName);
    if (!version) {
      throw new UserError(`"${input.versionName}" adlı release ${key} projesinde bulunamadı. "versions" komutu ile listeyi görebilirsiniz.`);
    }

    const issues = (await getVersionIssues(this.jira, key, version.id)).map(toIssueSummary);
    const groups: Record<StatusKind, IssueSummary[]> = { source: [], target: [], allowed: [], other: [] };
    for (const issue of issues) groups[classifyStatus({ id: issue.statusId, name: issue.status }, pc)].push(issue);

    // Her madde için geçişi önceden kontrol et ki sorunlar onaydan ÖNCE görünsün.
    const limit = pLimit(this.concurrency);
    const checks = await Promise.all(
      groups.source.map((issue) =>
        limit(async (): Promise<PlannedTransition | BlockedIssue> => {
          const transitions = await getTransitions(this.jira, issue.key);
          const t = selectTransition(transitions, target);
          if (!t) {
            const available = transitions.map((x) => `${x.name} → ${x.to.name}`).join(', ') || 'yok';
            return { issue, reason: `"${pc.targetStatus}" statüsüne doğrudan geçiş yok (mevcut geçişler: ${available})` };
          }
          const missing = missingRequiredFields(t, pc.transitionFields);
          if (missing.length) {
            return {
              issue,
              reason: `Geçiş için zorunlu alan(lar) eksik: ${missing.join(', ')} — config'te "transitionFields" ile tanımlayın`,
            };
          }
          return { issue, transitionId: t.id, transitionName: t.name, fields: fieldsForTransition(t, pc.transitionFields) };
        }),
      ),
    );

    return {
      project: { key: project.key, name: project.name, displayName: pc.displayName ?? project.name },
      version,
      deployedAt: (input.deployedAt ?? this.now()).toISOString(),
      triggeredBy: this.config.triggeredBy,
      sourceStatus: pc.sourceStatus,
      targetStatus: pc.targetStatus,
      ready: checks.filter((c): c is PlannedTransition => 'transitionId' in c),
      blocked: checks.filter((c): c is BlockedIssue => 'reason' in c),
      alreadyDone: groups.target,
      otherStatus: groups.other,
      ignored: groups.allowed,
    };
  }

  /** Engel içeren bir plan hiçbir koşulda (--yes dahil) uygulanmaz. */
  async execute(plan: ReleasePlan, opts: ExecuteOptions = {}): Promise<ReleaseResult> {
    const blockers = planBlockers(plan);
    if (blockers.length) {
      throw new UserError(`İşlem çalıştırılmadı, Jira'da hiçbir şey değiştirilmedi:\n  - ${blockers.join('\n  - ')}`);
    }
    await this.assertUnchanged(plan);
    const startedAt = this.now();
    const tz = this.config.timeZone;
    const pc = this.config.project(plan.project.key);
    const deployedAt = new Date(plan.deployedAt);
    const dateText = formatDateTr(deployedAt, tz);
    const timeText = formatTimeTr(deployedAt, tz);
    const withComment = opts.comment ?? pc.addComment;
    const commentText = renderTemplate(pc.commentTemplate, {
      date: dateText,
      time: timeText,
      version: plan.version.name,
      project: plan.project.displayName,
    });

    const limit = pLimit(this.concurrency);
    const outcomes = await Promise.all(
      plan.ready.map((p) =>
        limit(async (): Promise<CompletedIssue | FailedIssue> => {
          const base = { key: p.issue.key, summary: p.issue.summary };
          try {
            await doTransition(this.jira, p.issue.key, p.transitionId, p.fields);
          } catch (err) {
            return { ...base, error: errorMessage(err) };
          }
          if (!withComment) return base;
          try {
            await addComment(this.jira, p.issue.key, commentText);
            return base;
          } catch (err) {
            return { ...base, commentError: errorMessage(err) };
          }
        }),
      ),
    );
    const completed = outcomes.filter((o): o is CompletedIssue => !('error' in o));
    // Plan onaylandıktan sonra Jira'da oluşan hatalar (yetki, eşzamanlı değişiklik vb.)
    const failed = outcomes.filter((o): o is FailedIssue => 'error' in o);

    const releaseDate = toIsoDate(deployedAt, tz);
    let versionRelease: ReleaseResult['versionRelease'];
    if (plan.version.released) {
      versionRelease = { status: 'already-released', message: `Release zaten "Released" durumundaydı (${plan.version.releaseDate ?? 'tarihsiz'})` };
    } else if (failed.length > 0 && !opts.releaseWithErrors) {
      versionRelease = {
        status: 'skipped',
        message: `${failed.length} madde tamamlanamadığı için release "Released" yapılmadı`,
      };
    } else {
      try {
        await updateVersion(this.jira, plan.version.id, {
          released: true,
          releaseDate,
          ...(pc.appendTimeToVersionDescription
            ? { description: withDeployNote(plan.version.description, `${DEPLOY_NOTE_PREFIX} ${dateText} ${timeText}`) }
            : {}),
        });
        versionRelease = { status: 'released' };
      } catch (err) {
        versionRelease = { status: 'failed', message: errorMessage(err) };
      }
    }

    return {
      runId: `${fileStamp(startedAt, tz)}-${plan.project.key}-${plan.version.name.replace(/[^\w.-]+/g, '_')}`,
      startedAt: startedAt.toISOString(),
      finishedAt: this.now().toISOString(),
      project: plan.project,
      version: { id: plan.version.id, name: plan.version.name },
      versionUrl: versionUrl(this.config.jira.baseUrl, plan.project.key, plan.version.id),
      deployedAt: plan.deployedAt,
      releaseDate,
      triggeredBy: plan.triggeredBy,
      targetStatus: plan.targetStatus,
      completed,
      failed,
      alreadyDone: plan.alreadyDone.map(({ key, summary }) => ({ key, summary })),
      ignored: plan.ignored.map(({ key, summary, status }) => ({ key, summary, status })),
      versionRelease,
    };
  }

  /**
   * Önizleme ile onay arasında release'e madde eklenmiş/çıkarılmış ya da bir maddenin statüsü
   * değişmişse eski plan artık geçerli değildir; hiçbir şey yapmadan durur.
   */
  private async assertUnchanged(plan: ReleasePlan): Promise<void> {
    const expected = new Map<string, string>([
      ...plan.ready.map((p) => [p.issue.key, p.issue.statusId] as const),
      ...plan.alreadyDone.map((i) => [i.key, i.statusId] as const),
      ...plan.ignored.map((i) => [i.key, i.statusId] as const),
    ]);
    const current = await getVersionIssues(this.jira, plan.project.key, plan.version.id);
    const changed = current
      .filter((i) => expected.get(i.key) !== i.fields.status.id)
      .map((i) => `${i.key} (${i.fields.status.name})`);
    const currentKeys = new Set(current.map((i) => i.key));
    const removed = [...expected.keys()].filter((k) => !currentKeys.has(k));
    if (changed.length || removed.length) {
      throw new UserError(
        "Önizlemeden sonra release'te değişiklik oldu, işlem çalıştırılmadı ve Jira'da hiçbir şey değiştirilmedi." +
          (changed.length ? `\n  - Statüsü değişen/yeni eklenen: ${changed.join(', ')}` : '') +
          (removed.length ? `\n  - Release'ten çıkarılan: ${removed.join(', ')}` : '') +
          '\n  Komutu tekrar çalıştırıp güncel önizlemeyi kontrol edin.',
      );
    }
  }
}

/** Açıklamadaki eski "Canlı çıkış: ..." notunu yenisiyle değiştirir, yoksa sona ekler. */
export function withDeployNote(description: string | undefined, note: string): string {
  const cleaned = (description ?? '').replace(new RegExp(`\\s*\\|?\\s*${DEPLOY_NOTE_PREFIX}[^|]*$`), '').trim();
  return cleaned ? `${cleaned} | ${note}` : note;
}
