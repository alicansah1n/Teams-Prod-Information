import { stripVTControlCharacters } from 'node:util';
import { confirm, input, select } from '@inquirer/prompts';
import { loadConfig, type AppConfig } from '../config.js';
import { readAudit, updateAudit, writeAudit, type AuditRecord } from '../core/audit.js';
import { ReleaseService } from '../core/releaseService.js';
import { isFullySuccessful, planBlockers, type ReleasePlan } from '../core/types.js';
import { JiraClient } from '../jira/client.js';
import { getMyPermissions, getMyself, getProject, getProjectStatuses } from '../jira/projects.js';
import { statusMatches } from '../jira/transitions.js';
import { buildReleaseCard, buildTestCard } from '../teams/cards.js';
import { sendTeamsCard } from '../teams/webhookNotifier.js';
import { c } from '../util/console.js';
import { errorMessage, UserError } from '../util/errors.js';
import { parseDeployDate } from '../util/time.js';
import { printPlan, printResult } from './format.js';
import { badge, releasePicker } from './releasePicker.js';

const isInteractive = () => Boolean(process.stdin.isTTY && process.stdout.isTTY);

function createJira(config: AppConfig): JiraClient {
  return new JiraClient(config.jira);
}

async function pickProject(config: AppConfig, given?: string): Promise<string> {
  if (given) return given.trim().toUpperCase();
  if (config.projectKeys.length === 1) return config.projectKeys[0]!;
  if (!isInteractive()) throw new UserError('--project belirtilmeli.');
  if (config.projectKeys.length === 0) {
    return (await input({ message: 'Jira proje anahtarı (örn. OE):', required: true })).trim().toUpperCase();
  }
  return select({
    message: 'Proje seçin:',
    choices: config.projectKeys.map((k) => ({ name: `${k}  ${config.project(k).displayName ?? ''}`, value: k })),
  });
}

async function pickVersion(service: ReleaseService, projectKey: string, given?: string): Promise<string> {
  if (given) return given;
  if (!isInteractive()) throw new UserError('--version belirtilmeli.');
  console.log(c.gray(`${projectKey} release'leri yükleniyor...`));
  const items = await service.listVersionSummaries(projectKey);
  if (items.length === 0) throw new UserError(`${projectKey} projesinde yayınlanmamış (Unreleased) release yok.`);
  const pc = service.projectConfig(projectKey);
  return releasePicker({
    message: 'Canlıya çıkan release hangisi?',
    items,
    sourceStatus: pc.sourceStatus,
    targetStatus: pc.targetStatus,
    pageSize: Math.max(5, Math.min(15, (process.stdout.rows ?? 30) - 8)),
  });
}

function confirmMessage(plan: ReleasePlan): string {
  const parts = [
    plan.ready.length
      ? `${plan.ready.length} madde "${plan.targetStatus}" yapılacak`
      : `Tüm maddeler zaten "${plan.targetStatus}"`,
  ];
  if (!plan.version.released) parts.push('release "Released" yapılacak');
  parts.push("Teams'e bildirim gidecek");
  return `${parts.join(', ')}. Onaylıyor musunuz?`;
}

export interface ReleaseOptions {
  project?: string;
  version?: string;
  date?: string;
  dryRun?: boolean;
  yes?: boolean;
  comment: boolean;
  notify: boolean;
  releaseWithErrors?: boolean;
}

export async function releaseCommand(opts: ReleaseOptions): Promise<void> {
  const config = loadConfig();
  const service = new ReleaseService({ jira: createJira(config), config });

  const projectKey = await pickProject(config, opts.project);
  const versionName = await pickVersion(service, projectKey, opts.version);
  const deployedAt = opts.date ? parseDeployDate(opts.date, config.timeZone) : undefined;

  console.log(c.gray(`${projectKey} / ${versionName} inceleniyor...`));
  const plan = await service.plan({ projectKey, versionName, deployedAt });
  printPlan(plan, config.timeZone);

  if (planBlockers(plan).length) {
    // Ya hep ya hiç: onay bile sorulmaz, dry-run'da da aynı sonuç gösterilir.
    console.log(c.red("İşlem çalıştırılmadı, Jira'da hiçbir şey değiştirilmedi."));
    process.exitCode = 3;
    return;
  }
  if (opts.dryRun) {
    console.log(c.yellow('Dry-run: Jira\'da hiçbir değişiklik yapılmadı, Teams\'e mesaj gönderilmedi.'));
    return;
  }
  if (!opts.yes) {
    if (!isInteractive()) throw new UserError('Onay için interaktif terminal gerekli; otomasyonda --yes kullanın.');
    if (!(await confirm({ message: confirmMessage(plan), default: false }))) {
      console.log('İptal edildi, hiçbir değişiklik yapılmadı.');
      return;
    }
  }

  console.log(c.gray('Jira güncelleniyor...'));
  const result = await service.execute(plan, {
    comment: opts.comment ? undefined : false,
    releaseWithErrors: opts.releaseWithErrors,
  });
  printResult(result);

  const record: AuditRecord = { plan, result };
  const logFile = writeAudit(config.logDir, record);

  if (!opts.notify) {
    record.notification = { skipped: '--no-notify' };
  } else if (!config.teams.webhookUrl) {
    record.notification = { skipped: 'TEAMS_WEBHOOK_URL tanımlı değil' };
    console.log(c.yellow('⚠ TEAMS_WEBHOOK_URL tanımlı olmadığı için Teams bildirimi gönderilmedi.'));
  } else {
    try {
      await sendTeamsCard(config.teams.webhookUrl, buildReleaseCard(result, { jiraBaseUrl: config.jira.baseUrl, timeZone: config.timeZone }));
      record.notification = { sentAt: new Date().toISOString() };
      console.log(c.green('✔ Teams kanalına bildirim gönderildi.'));
    } catch (err) {
      record.notification = { error: errorMessage(err) };
      console.log(c.red(`✖ Teams bildirimi gönderilemedi: ${errorMessage(err)}`));
      console.log(c.gray(`  Tekrar denemek için: npm run notify -- --log "${logFile}"`));
    }
  }
  updateAudit(logFile, record);
  console.log(c.gray(`Kayıt: ${logFile}`));

  if (!isFullySuccessful(result)) process.exitCode = 2;
}

export async function versionsCommand(opts: { project?: string }): Promise<void> {
  const config = loadConfig();
  const service = new ReleaseService({ jira: createJira(config), config });
  const projectKey = await pickProject(config, opts.project);
  const pc = config.project(projectKey);
  const items = await service.listVersionSummaries(projectKey);

  console.log();
  console.log(c.bold(`${projectKey} — Unreleased release'ler ("${pc.sourceStatus}" bekleyen madde sayısı)`));
  if (items.length === 0) console.log(c.gray('  (yok)'));
  for (const s of items) {
    const breakdown = s.statuses.map((st) => `${st.name}: ${st.count}`).join(' · ');
    console.log(`  ${s.version.name.padEnd(32)} ${padBadge(badge(s))} ${c.gray(breakdown)}`);
  }
  console.log();
  console.log(c.gray('  ✔ uygun (bekleyenler Completed yapılır / hepsi tamamsa sadece kapatılır) · ✖ uygun değil: farklı statüde madde var ya da madde yok'));
  console.log();
}

const padBadge = (s: string) => s + ' '.repeat(Math.max(0, 19 - stripVTControlCharacters(s).length));

export async function notifyCommand(opts: { log: string }): Promise<void> {
  const config = loadConfig();
  if (!config.teams.webhookUrl) throw new UserError('TEAMS_WEBHOOK_URL tanımlı değil.');
  const record = readAudit(opts.log);
  await sendTeamsCard(config.teams.webhookUrl, buildReleaseCard(record.result, { jiraBaseUrl: config.jira.baseUrl, timeZone: config.timeZone }));
  record.notification = { sentAt: new Date().toISOString() };
  updateAudit(opts.log, record);
  console.log(c.green('✔ Teams kanalına bildirim gönderildi.'));
}

const REQUIRED_PERMISSIONS = ['BROWSE_PROJECTS', 'TRANSITION_ISSUES', 'ADD_COMMENTS'];
const VERSION_PERMISSION = 'ADMINISTER_PROJECTS';

export async function doctorCommand(opts: { project?: string; teamsTest?: boolean }): Promise<void> {
  let failures = 0;
  const pass = (msg: string) => console.log(`${c.green('✔')} ${msg}`);
  const warn = (msg: string) => console.log(`${c.yellow('⚠')} ${msg}`);
  const fail = (msg: string) => {
    failures++;
    console.log(`${c.red('✖')} ${msg}`);
  };

  const config = loadConfig();
  pass(`Ayarlar yüklendi (Jira: ${config.jira.baseUrl}, saat dilimi: ${config.timeZone}, tetikleyen: ${config.triggeredBy})`);
  const jira = createJira(config);

  try {
    const me = await getMyself(jira);
    pass(`Jira bağlantısı: ${me.displayName}${me.emailAddress ? ` <${me.emailAddress}>` : ''}`);
  } catch (err) {
    fail(`Jira bağlantısı: ${errorMessage(err)}`);
    process.exitCode = 1;
    return;
  }

  const keys = opts.project ? [opts.project.toUpperCase()] : config.projectKeys;
  if (keys.length === 0) warn('config/releases.config.json içinde proje yok; --project ile kontrol edin.');

  for (const key of keys) {
    const pc = config.project(key);
    try {
      const project = await getProject(jira, key);
      pass(`[${key}] Proje erişimi: ${project.name}`);
    } catch (err) {
      fail(`[${key}] Proje erişimi: ${errorMessage(err)}`);
      continue;
    }

    try {
      const perms = await getMyPermissions(jira, key, [...REQUIRED_PERMISSIONS, VERSION_PERMISSION]);
      const missing = REQUIRED_PERMISSIONS.filter((p) => !perms[p]);
      if (missing.length) fail(`[${key}] Eksik yetkiler: ${missing.join(', ')}`);
      else pass(`[${key}] Yetkiler: ${REQUIRED_PERMISSIONS.join(', ')}`);
      if (!perms[VERSION_PERMISSION]) {
        warn(`[${key}] ${VERSION_PERMISSION} yetkisi yok — release'i "Released" yapmak için genellikle gerekir.`);
      }
    } catch (err) {
      fail(`[${key}] Yetki kontrolü: ${errorMessage(err)}`);
    }

    try {
      const statuses = await getProjectStatuses(jira, key);
      for (const [label, target] of [
        ['Kaynak statü', { name: pc.sourceStatus, id: pc.sourceStatusId }],
        ['Hedef statü', { name: pc.targetStatus, id: pc.targetStatusId }],
      ] as const) {
        const found = statuses.find((s) => statusMatches(s, target));
        if (found) pass(`[${key}] ${label}: "${found.name}" (id ${found.id})`);
        else fail(`[${key}] ${label} "${target.id ?? target.name}" projede yok. Mevcut: ${statuses.map((s) => s.name).join(', ')}`);
      }
    } catch (err) {
      fail(`[${key}] Statü kontrolü: ${errorMessage(err)}`);
    }
  }

  if (!config.teams.webhookUrl) {
    warn('TEAMS_WEBHOOK_URL tanımlı değil — bildirim gönderilemez.');
  } else if (opts.teamsTest) {
    try {
      await sendTeamsCard(config.teams.webhookUrl, buildTestCard(config.triggeredBy, new Date(), config.timeZone));
      pass('Teams test mesajı gönderildi — kanalı kontrol edin.');
    } catch (err) {
      fail(`Teams webhook: ${errorMessage(err)}`);
    }
  } else {
    pass('TEAMS_WEBHOOK_URL tanımlı (test mesajı için: npm run doctor -- --teams-test)');
  }

  console.log();
  if (failures) {
    console.log(c.red(`${failures} kontrol başarısız.`));
    process.exitCode = 1;
  } else {
    console.log(c.green('Tüm kontroller başarılı.'));
  }
}
