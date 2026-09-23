import { UserError } from './errors.js';

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClockIn(date: Date, timeZone: string): WallClock {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return {
    year: p.year!,
    month: p.month!,
    day: p.day!,
    hour: p.hour!,
    minute: p.minute!,
    second: p.second!,
  };
}

/** Saat diliminin verilen andaki UTC farkı (ms). */
function offsetMs(date: Date, timeZone: string): number {
  const w = wallClockIn(date, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Belirtilen saat dilimindeki duvar saatini (örn. İstanbul 14:30) gerçek bir Date'e çevirir. */
export function zonedTimeToDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let ts = guess - offsetMs(new Date(guess), timeZone);
  // Yaz saati geçişlerinde ofset değişebileceği için bir kez daha düzelt.
  ts = guess - offsetMs(new Date(ts), timeZone);
  return new Date(ts);
}

/**
 * Kullanıcının girdiği canlı çıkış zamanını çözer.
 * Kabul edilen biçimler: "2026-09-23 14:30", "2026-09-23T14:30", "23.09.2026 14:30", "2026-09-23" (saat 00:00).
 */
export function parseDeployDate(input: string, timeZone: string): Date {
  const s = input.trim();
  let parts: number[] | undefined;
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(s);
  if (m) {
    parts = [m[1], m[2], m[3], m[4] ?? '0', m[5] ?? '0'].map(Number);
  } else if ((m = /^(\d{2})\.(\d{2})\.(\d{4})(?: (\d{1,2}):(\d{2}))?$/.exec(s))) {
    parts = [m[3], m[2], m[1], m[4] ?? '0', m[5] ?? '0'].map(Number);
  }
  if (!parts) {
    throw new UserError(`Tarih anlaşılamadı: "${input}". Örnek: "2026-09-23 14:30" veya "23.09.2026 14:30"`);
  }
  const [year, month, day, hour, minute] = parts as [number, number, number, number, number];
  const date = zonedTimeToDate(year, month, day, hour, minute, timeZone);
  const back = wallClockIn(date, timeZone);
  if (back.year !== year || back.month !== month || back.day !== day || back.hour !== hour || back.minute !== minute) {
    throw new UserError(`Geçersiz tarih/saat: "${input}"`);
  }
  return date;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "23.09.2026" */
export function formatDateTr(date: Date, timeZone: string): string {
  const w = wallClockIn(date, timeZone);
  return `${pad(w.day)}.${pad(w.month)}.${w.year}`;
}

/** "14:30" */
export function formatTimeTr(date: Date, timeZone: string): string {
  const w = wallClockIn(date, timeZone);
  return `${pad(w.hour)}:${pad(w.minute)}`;
}

/** Jira releaseDate için "2026-09-23" */
export function toIsoDate(date: Date, timeZone: string): string {
  const w = wallClockIn(date, timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** Dosya adında kullanılabilecek zaman damgası: "20260923-143012" */
export function fileStamp(date: Date, timeZone: string): string {
  const w = wallClockIn(date, timeZone);
  return `${w.year}${pad(w.month)}${pad(w.day)}-${pad(w.hour)}${pad(w.minute)}${pad(w.second)}`;
}

export function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new UserError(`Geçersiz saat dilimi: "${timeZone}" (örn. Europe/Istanbul)`);
  }
}
