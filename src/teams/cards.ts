import { isFullySuccessful, type ReleaseResult } from '../core/types.js';
import { issueUrl } from '../jira/issues.js';
import { formatDateTr, formatTimeTr } from '../util/time.js';

export interface AdaptiveCard {
  $schema: string;
  type: 'AdaptiveCard';
  version: string;
  body: unknown[];
  actions?: unknown[];
  msteams?: { width: 'Full' };
}

export interface CardContext {
  jiraBaseUrl: string;
  timeZone: string;
}

const MAX_LISTED = 20;

function card(body: unknown[], actions: unknown[] = []): AdaptiveCard {
  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    msteams: { width: 'Full' },
    body,
    ...(actions.length ? { actions } : {}),
  };
}

/** Köşeli parantezler markdown link sözdizimini bozar. */
const safe = (s: string) => s.replace(/\[/g, '(').replace(/\]/g, ')');

function bulletList(lines: string[], max: number): string {
  const shown = lines.slice(0, max);
  if (lines.length > max) shown.push(`…ve ${lines.length - max} madde daha`);
  return shown.map((l) => `- ${l}`).join('\r');
}

function section(title: string, lines: string[], max: number, color?: 'Attention' | 'Warning'): unknown[] {
  if (lines.length === 0) return [];
  return [
    { type: 'TextBlock', text: title, weight: 'Bolder', spacing: 'Medium', wrap: true, ...(color ? { color } : {}) },
    { type: 'TextBlock', text: bulletList(lines, max), wrap: true, spacing: 'Small' },
  ];
}

function versionReleaseText(r: ReleaseResult, tz: string): string {
  switch (r.versionRelease.status) {
    case 'released':
      return `Released olarak işaretlendi (${formatDateTr(new Date(r.deployedAt), tz)})`;
    case 'already-released':
      return 'Zaten Released durumundaydı';
    case 'skipped':
      return `Released yapılmadı — ${r.versionRelease.message ?? ''}`;
    case 'failed':
      return `Güncellenemedi — ${r.versionRelease.message ?? ''}`;
  }
}

export function buildReleaseCard(r: ReleaseResult, ctx: CardContext): AdaptiveCard {
  const ok = isFullySuccessful(r);
  const deployedAt = new Date(r.deployedAt);
  const date = formatDateTr(deployedAt, ctx.timeZone);
  const time = formatTimeTr(deployedAt, ctx.timeZone);
  const link = (key: string) => `[${key}](${issueUrl(ctx.jiraBaseUrl, key)})`;

  const facts = [
    { title: 'Paket', value: r.project.displayName },
    { title: 'Sürüm', value: r.version.name },
    { title: 'Canlı çıkış', value: `${date} ${time}` },
    { title: `${r.targetStatus} yapılan`, value: String(r.completed.length) },
    ...(r.alreadyDone.length ? [{ title: 'Zaten tamamlanmış', value: String(r.alreadyDone.length) }] : []),
    ...(r.failed.length ? [{ title: 'Hatalı', value: String(r.failed.length) }] : []),
    ...(r.ignored.length ? [{ title: 'Hariç tutulan', value: String(r.ignored.length) }] : []),
    { title: 'Release durumu', value: versionReleaseText(r, ctx.timeZone) },
    { title: 'Tetikleyen', value: r.triggeredBy },
  ];

  return card(
    [
      {
        type: 'Container',
        style: ok ? 'good' : 'warning',
        bleed: true,
        items: [
          {
            type: 'TextBlock',
            text: ok ? '✅ Canlı Çıkış Tamamlandı' : '⚠️ Canlı Çıkış — Kontrol Gerekli',
            size: 'Large',
            weight: 'Bolder',
            wrap: true,
          },
        ],
      },
      {
        type: 'TextBlock',
        wrap: true,
        spacing: 'Medium',
        text: `**${r.project.displayName}** paketindeki **${r.version.name}** sürümü **${date} ${time}** tarihinde canlıya çıkılmıştır.`,
      },
      ...(ok
        ? []
        : [{ type: 'TextBlock', wrap: true, color: 'Warning', text: 'Bazı Jira güncellemeleri yapılamadı, detaylar aşağıda.' }]),
      { type: 'FactSet', facts, spacing: 'Medium' },
      // Paket içeriği listelenmez (kanal şişmesin); detay için "Release'i Jira'da aç" butonu yeterli.
      // Sadece hata varsa, hangi maddede ne olduğu görünsün diye hatalılar listelenir.
      ...section(
        `Hatalı maddeler (${r.failed.length})`,
        r.failed.map((i) => `${link(i.key)} ${safe(i.summary)} — _${safe(i.error)}_`),
        MAX_LISTED,
        'Attention',
      ),
    ],
    [{ type: 'Action.OpenUrl', title: "Release'i Jira'da aç", url: r.versionUrl }],
  );
}

export function buildTestCard(triggeredBy: string, when: Date, timeZone: string): AdaptiveCard {
  return card([
    { type: 'TextBlock', text: '🔔 Bağlantı testi', size: 'Medium', weight: 'Bolder' },
    {
      type: 'TextBlock',
      wrap: true,
      text: `Canlı çıkış bildirimleri bu kanala gelecek. (${triggeredBy}, ${formatDateTr(when, timeZone)} ${formatTimeTr(when, timeZone)})`,
    },
  ]);
}
