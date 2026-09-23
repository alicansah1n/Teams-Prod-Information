import type { IssueSummary, JiraVersion } from '../jira/types.js';

export interface ProjectInfo {
  key: string;
  name: string;
  /** Mesajlarda "paket" adı olarak görünen isim (config displayName, yoksa Jira proje adı) */
  displayName: string;
}

export interface PlannedTransition {
  issue: IssueSummary;
  transitionId: string;
  transitionName: string;
  fields: Record<string, unknown>;
}

export interface BlockedIssue {
  issue: IssueSummary;
  reason: string;
}

/** Onaydan önce kullanıcıya gösterilen, henüz hiçbir şeyi değiştirmemiş hazırlık sonucu. */
export interface ReleasePlan {
  project: ProjectInfo;
  version: JiraVersion;
  /** ISO 8601 */
  deployedAt: string;
  triggeredBy: string;
  sourceStatus: string;
  targetStatus: string;
  /** Statüsü değiştirilecek maddeler */
  ready: PlannedTransition[];
  /** Kaynak statüde ama hedefe geçirilemeyecek maddeler (geçiş yok / zorunlu alan eksik) */
  blocked: BlockedIssue[];
  /** Zaten hedef statüde olanlar */
  alreadyDone: IssueSummary[];
  /** Kaynak/hedef/izinli statüler dışında kalanlar — varsa işlem HİÇ çalıştırılmaz */
  otherStatus: IssueSummary[];
  /** Config'teki allowedStatuses statüsünde olanlar (örn. Canceled) — engel değil, dokunulmaz */
  ignored: IssueSummary[];
}

/**
 * Plan uygulanabilir mi? Ya hep ya hiç: release'te beklenmeyen statüde veya
 * hedefe geçirilemeyen tek bir madde bile varsa hiçbir değişiklik yapılmaz.
 */
export function planBlockers(plan: ReleasePlan): string[] {
  const blockers: string[] = [];
  if (plan.otherStatus.length) {
    const statuses = [...new Set(plan.otherStatus.map((i) => i.status))].join(', ');
    blockers.push(
      `Release'te "${plan.sourceStatus}" / "${plan.targetStatus}" dışında statüde ${plan.otherStatus.length} madde var (${statuses})`,
    );
  }
  if (plan.blocked.length) {
    blockers.push(`"${plan.targetStatus}" statüsüne geçirilemeyen ${plan.blocked.length} madde var`);
  }
  // Hepsi Completed olan release işlenebilir (sadece kapatılır ve bildirilir); ama hiç madde yoksa işlenmez.
  if (plan.ready.length + plan.blocked.length + plan.alreadyDone.length === 0) {
    blockers.push(`Release'te "${plan.sourceStatus}" veya "${plan.targetStatus}" statüsünde hiç madde yok`);
  }
  return blockers;
}

/** Bir statünün release kuralları açısından anlamı */
export type StatusKind = 'source' | 'target' | 'allowed' | 'other';

/**
 * Release listesinde gösterilen ön değerlendirme:
 * ready = maddelerin hepsi "To be Deployed" ve/veya "Completed" (hepsi Completed da olabilir),
 * blocked = başka statüde en az bir madde var, empty = release'te madde yok.
 * blocked ve empty "uygun değil" olarak gösterilir; seçilebilir ama işlem başlatılamaz.
 */
export type VersionEligibility = 'ready' | 'blocked' | 'empty';

export interface VersionSummary {
  version: JiraVersion;
  /** Sıra: kaynak, hedef, izinli, diğerleri (çoktan aza) */
  statuses: { name: string; kind: StatusKind; count: number }[];
  total: number;
  /** Kaynak statüdeki ("To be Deployed") madde sayısı */
  pending: number;
  /** Hedef statüdeki ("Completed") madde sayısı */
  done: number;
  /** Kaynak/hedef/izinli dışındaki statülerde olan madde sayısı */
  otherCount: number;
  eligibility: VersionEligibility;
}

export type VersionReleaseStatus = 'released' | 'already-released' | 'skipped' | 'failed';

export interface CompletedIssue {
  key: string;
  summary: string;
  commentError?: string;
}

export interface FailedIssue {
  key: string;
  summary: string;
  error: string;
}

/** JSON olarak loglanabilir; Teams kartı sadece bundan üretilir (notify ile tekrar gönderim için). */
export interface ReleaseResult {
  runId: string;
  startedAt: string;
  finishedAt: string;
  project: ProjectInfo;
  version: { id: string; name: string };
  versionUrl: string;
  deployedAt: string;
  /** Jira'ya yazılan releaseDate (yyyy-MM-dd) */
  releaseDate: string;
  triggeredBy: string;
  targetStatus: string;
  completed: CompletedIssue[];
  failed: FailedIssue[];
  alreadyDone: { key: string; summary: string }[];
  ignored: { key: string; summary: string; status: string }[];
  versionRelease: { status: VersionReleaseStatus; message?: string };
}

export function isFullySuccessful(r: ReleaseResult): boolean {
  return r.failed.length === 0 && (r.versionRelease.status === 'released' || r.versionRelease.status === 'already-released');
}
