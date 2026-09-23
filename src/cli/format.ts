import { planBlockers, type ReleasePlan, type ReleaseResult } from '../core/types.js';
import { c, truncate } from '../util/console.js';
import { formatDateTr, formatTimeTr, toIsoDate } from '../util/time.js';

const SUMMARY_WIDTH = 70;

function row(key: string, text: string, extra = ''): string {
  return `  ${c.cyan(key.padEnd(10))} ${truncate(text, SUMMARY_WIDTH)}${extra ? `  ${c.gray(extra)}` : ''}`;
}

export function printPlan(plan: ReleasePlan, timeZone: string): void {
  const deployedAt = new Date(plan.deployedAt);
  const v = plan.version;
  const versionState = v.released ? c.yellow('[Zaten Released]') : c.gray('[Unreleased]');

  console.log();
  console.log(c.bold('── Önizleme ─────────────────────────────────────────────'));
  console.log(`  Paket       : ${plan.project.displayName} (${plan.project.key})`);
  console.log(`  Release     : ${v.name}  ${versionState}${v.releaseDate ? c.gray(`  (Jira'daki tarih: ${v.releaseDate})`) : ''}`);
  console.log(
    `  Canlı çıkış : ${formatDateTr(deployedAt, timeZone)} ${formatTimeTr(deployedAt, timeZone)}` +
      c.gray(`  (Jira releaseDate → ${toIsoDate(deployedAt, timeZone)})`),
  );
  console.log(`  Tetikleyen  : ${plan.triggeredBy}`);
  console.log();

  console.log(c.green(`✔ "${plan.sourceStatus}" → "${plan.targetStatus}" yapılacak (${plan.ready.length}):`));
  if (plan.ready.length === 0) console.log(c.gray('  (yok)'));
  for (const p of plan.ready) {
    console.log(row(p.issue.key, p.issue.summary, `${p.issue.issueType ?? ''} · geçiş: ${p.transitionName}`));
  }

  if (plan.blocked.length) {
    console.log();
    console.log(c.red(`✖ "${plan.sourceStatus}" durumunda ama geçirilemeyecek (${plan.blocked.length}):`));
    for (const b of plan.blocked) {
      console.log(row(b.issue.key, b.issue.summary));
      console.log(`             ${c.red(b.reason)}`);
    }
  }

  if (plan.alreadyDone.length) {
    console.log();
    console.log(c.gray(`• Zaten "${plan.targetStatus}" (${plan.alreadyDone.length}): ${plan.alreadyDone.map((i) => i.key).join(', ')}`));
  }

  if (plan.ignored.length) {
    console.log();
    console.log(c.gray(`• İzinli statüde, dokunulmayacak (${plan.ignored.length}):`));
    for (const i of plan.ignored) console.log(row(i.key, i.summary, i.status));
  }

  if (plan.otherStatus.length) {
    console.log();
    console.log(c.red(`✖ "${plan.sourceStatus}" / "${plan.targetStatus}" dışında statüde olan maddeler (${plan.otherStatus.length}):`));
    for (const i of plan.otherStatus) console.log(row(i.key, i.summary, i.status));
  }

  const blockers = planBlockers(plan);
  if (blockers.length) {
    console.log();
    console.log(c.red(c.bold('✖ BU RELEASE İÇİN İŞLEM YAPILAMAZ:')));
    for (const b of blockers) console.log(c.red(`  - ${b}`));
    console.log(c.gray(`  Tüm maddeler "${plan.sourceStatus}" veya "${plan.targetStatus}" olduğunda tekrar çalıştırın.`));
  }
  console.log(c.bold('─────────────────────────────────────────────────────────'));
  console.log();
}

export function printResult(r: ReleaseResult): void {
  console.log();
  console.log(c.bold('── Sonuç ────────────────────────────────────────────────'));
  console.log(c.green(`  ✔ "${r.targetStatus}" yapılan: ${r.completed.length}`));
  for (const i of r.completed.filter((x) => x.commentError)) {
    console.log(c.yellow(`  ⚠ ${i.key}: statü değişti ama yorum eklenemedi — ${i.commentError}`));
  }
  if (r.failed.length) {
    console.log(c.red(`  ✖ Hatalı: ${r.failed.length}`));
    for (const f of r.failed) console.log(c.red(`    ${f.key}: ${f.error}`));
  }
  const vr = r.versionRelease;
  const vrText = {
    released: c.green(`  ✔ Release "Released" yapıldı, tarih: ${r.releaseDate}`),
    'already-released': c.gray(`  • ${vr.message}`),
    skipped: c.yellow(`  ⚠ ${vr.message} (zorlamak için --release-with-errors)`),
    failed: c.red(`  ✖ Release güncellenemedi: ${vr.message}`),
  }[vr.status];
  console.log(vrText);
  console.log(c.gray(`  Jira: ${r.versionUrl}`));
  console.log(c.bold('─────────────────────────────────────────────────────────'));
}
