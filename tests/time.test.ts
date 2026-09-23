import { describe, expect, it } from 'vitest';
import { formatDateTr, formatTimeTr, parseDeployDate, toIsoDate } from '../src/util/time.js';

const TZ = 'Europe/Istanbul';

describe('time', () => {
  it('İstanbul saatini doğru UTC anına çevirir', () => {
    expect(parseDeployDate('2026-09-23 14:30', TZ).toISOString()).toBe('2026-09-23T11:30:00.000Z');
    expect(parseDeployDate('23.09.2026 14:30', TZ).toISOString()).toBe('2026-09-23T11:30:00.000Z');
    expect(parseDeployDate('2026-09-23', TZ).toISOString()).toBe('2026-09-22T21:00:00.000Z');
  });

  it('geçersiz tarihleri reddeder', () => {
    expect(() => parseDeployDate('2026-02-30 10:00', TZ)).toThrow(/Geçersiz/);
    expect(() => parseDeployDate('dün akşam', TZ)).toThrow(/anlaşılamadı/);
    expect(() => parseDeployDate('2026-09-23 25:00', TZ)).toThrow(/Geçersiz/);
  });

  it('Türkçe biçimler ve gece yarısı sınırında doğru gün', () => {
    const d = new Date('2026-09-22T22:30:00Z'); // İstanbul: 23.09.2026 01:30
    expect(formatDateTr(d, TZ)).toBe('23.09.2026');
    expect(formatTimeTr(d, TZ)).toBe('01:30');
    expect(toIsoDate(d, TZ)).toBe('2026-09-23');
  });
});
