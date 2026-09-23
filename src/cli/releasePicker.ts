import { cursorHide } from '@inquirer/ansi';
import {
  createPrompt,
  isBackspaceKey,
  isDownKey,
  isEnterKey,
  isUpKey,
  makeTheme,
  useEffect,
  useKeypress,
  usePagination,
  usePrefix,
  useRef,
  useState,
} from '@inquirer/core';
import figures from '@inquirer/figures';
import { stripVTControlCharacters } from 'node:util';
import type { StatusKind, VersionSummary } from '../core/types.js';
import { c, truncate } from '../util/console.js';

/** Kartın toplam genişliği (kenarlıklar dahil) */
export const CARD_WIDTH = 38;
const GAP = 2;
const NAME_MAX = 32;
const NAME_MIN = 16;
/** En uzun işaret: "✖ 999 farklı statü" */
const BADGE_WIDTH = 18;
const MAX_STATUS_ROWS = 8;

export interface CardLabels {
  sourceStatus: string;
  targetStatus: string;
}

const visibleWidth = (s: string) => stripVTControlCharacters(s).length;
const padVisible = (s: string, width: number) => s + ' '.repeat(Math.max(0, width - visibleWidth(s)));

const KIND_COLOR: Record<StatusKind, (s: string) => string> = {
  source: c.green,
  target: c.gray,
  allowed: c.gray,
  other: c.red,
};

/** Listede release adının yanındaki işaret */
export function badge(s: VersionSummary): string {
  switch (s.eligibility) {
    case 'ready':
      return c.green(s.pending ? `${figures.tick} ${s.pending} bekliyor` : `${figures.tick} hepsi tamam`);
    case 'blocked':
      return c.red(`${figures.cross} ${s.otherCount} farklı statü`);
    case 'empty':
      return c.red(`${figures.cross} madde yok`);
  }
}

/** Seçili release'in detayı + işaretlerin açıklaması */
export function renderInfoCard(s: VersionSummary, labels: CardLabels, width = CARD_WIDTH): string[] {
  const inner = width - 4;
  // Metinler renklendirilmeden ÖNCE `fit` ile kesilir; row sadece hizalar.
  const fit = (text: string) => truncate(text, inner);
  const row = (text = '') => `${c.gray('│')} ${padVisible(text, inner)} ${c.gray('│')}`;
  const rule = (left: string, right: string, title = '') => {
    const t = title ? truncate(title, width - 6) : '';
    const head = t ? `─ ${t} ` : '';
    return c.gray(left + (t ? '─ ' : '')) + c.bold(t) + c.gray((t ? ' ' : '') + '─'.repeat(Math.max(0, width - 2 - head.length)) + right);
  };

  const lines = [rule('┌', '┐', s.version.name), row(c.gray(`Planlanan tarih: ${s.version.releaseDate ?? '—'}`)), row()];

  if (s.total === 0) {
    lines.push(row(c.gray("Bu release'te hiç madde yok")));
  } else {
    const shown = s.statuses.slice(0, MAX_STATUS_ROWS);
    for (const st of shown) {
      const count = String(st.count).padStart(5);
      lines.push(row(KIND_COLOR[st.kind](`${truncate(st.name, inner - 6).padEnd(inner - 5)}${count}`)));
    }
    if (s.statuses.length > shown.length) lines.push(row(c.gray(`+${s.statuses.length - shown.length} statü daha`)));
  }
  lines.push(row());

  switch (s.eligibility) {
    case 'ready':
      lines.push(row(c.green(c.bold(`${figures.tick} UYGUN`))));
      if (s.pending) lines.push(row(fit(`  ${s.pending} madde "${labels.targetStatus}" yapılacak`)));
      else lines.push(row(fit(`  Hepsi zaten "${labels.targetStatus}",`)), row('  release sadece kapatılır'));
      break;
    case 'blocked':
      lines.push(
        row(c.red(c.bold(`${figures.cross} UYGUN DEĞİL`))),
        row(`  ${s.otherCount} madde farklı statüde`),
        row(c.gray('  Görüntülenir, işlem başlatılamaz')),
      );
      break;
    case 'empty':
      lines.push(
        row(c.red(c.bold(`${figures.cross} UYGUN DEĞİL`))),
        row("  Release'te madde yok"),
        row(c.gray('  Görüntülenir, işlem başlatılamaz')),
      );
      break;
  }

  lines.push(
    rule('├', '┤', 'Açıklama'),
    row(`${c.green(figures.tick)} N bekliyor: çalıştırılabilir`),
    row(`${c.green(figures.tick)} hepsi tamam: sadece kapatılır`),
    row(`${c.red(figures.cross)} farklı statü / madde yok:`),
    row('  uygun değil, işlem başlamaz'),
    row(c.gray(fit(`Sayı: "${labels.sourceStatus}" adedi`))),
    rule('└', '┘'),
  );
  return lines;
}

/** İki sütunu yan yana birleştirir. */
export function sideBySide(left: string[], right: string[], leftWidth: number): string[] {
  const n = Math.max(left.length, right.length);
  return Array.from({ length: n }, (_, i) => `${padVisible(left[i] ?? '', leftWidth)}${' '.repeat(GAP)}${right[i] ?? ''}`.trimEnd());
}

export interface ReleasePickerConfig extends CardLabels {
  message: string;
  items: VersionSummary[];
  pageSize?: number;
}

/**
 * Release seçim listesi: solda release'ler, sağda üzerinde bulunulan release'in bilgi kartı.
 * Terminal dar ise kart listenin altına düşer. Tüm release'ler seçilebilir; uygun olmayanlar
 * önizlemede "işlem yapılamaz" olarak durdurulur.
 */
export const releasePicker = createPrompt<string, ReleasePickerConfig>((config, done) => {
  const theme = makeTheme();
  const [status, setStatus] = useState<'idle' | 'done'>('idle');
  const prefix = usePrefix({ status, theme });
  const [active, setActive] = useState(0);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { items } = config;
  const selected = items[active]!;
  const columns = process.stdout.columns ?? 80;
  // Kart sağa sığsın diye gerekirse release adı sütunu daralır (adlar "…" ile kısalır).
  const roomForName = columns - 1 - (2 + 1 + BADGE_WIDTH + GAP + CARD_WIDTH);
  const longestName = Math.max(...items.map((i) => i.version.name.length));
  const nameCol = Math.max(Math.min(NAME_MIN, longestName), Math.min(NAME_MAX, longestName, roomForName));

  useKeypress((key, rl) => {
    clearTimeout(searchTimeout.current);
    if (isEnterKey(key)) {
      setStatus('done');
      done(selected.version.name);
    } else if (isUpKey(key) || isDownKey(key)) {
      rl.clearLine(0);
      setActive((active + (isUpKey(key) ? -1 : 1) + items.length) % items.length);
    } else if (isBackspaceKey(key)) {
      rl.clearLine(0);
    } else {
      // Harf yazınca adı öyle başlayan ilk release'e atla
      const term = rl.line.toLocaleLowerCase('tr-TR');
      const index = items.findIndex((i) => i.version.name.toLocaleLowerCase('tr-TR').startsWith(term));
      if (term && index !== -1) setActive(index);
      searchTimeout.current = setTimeout(() => rl.clearLine(0), 700);
    }
  });
  useEffect(() => () => clearTimeout(searchTimeout.current), []);

  const page = usePagination({
    items,
    active,
    pageSize: config.pageSize ?? 15,
    renderItem({ item, isActive }) {
      const name = padVisible(truncate(item.version.name, nameCol), nameCol);
      return isActive
        ? `${c.cyan(figures.pointer)} ${c.cyan(c.bold(name))} ${badge(item)}`
        : `  ${name} ${badge(item)}`;
    },
  });

  const message = theme.style.message(config.message, status);
  if (status === 'done') return `${prefix} ${message} ${theme.style.answer(selected.version.name)}`;

  const leftLines = page.split('\n');
  const card = renderInfoCard(selected, config);
  const leftWidth = 2 + nameCol + 1 + BADGE_WIDTH;
  const fitsSideBySide = columns - 1 >= leftWidth + GAP + CARD_WIDTH;
  const body = fitsSideBySide ? sideBySide(leftLines, card, leftWidth) : [...leftLines, '', ...card];
  const help = c.gray('↑↓ gez • Enter seç • harf yazarak ara • Ctrl+C çık');

  return `${[`${prefix} ${message}`, ...body, help].join('\n')}${cursorHide}`;
});
