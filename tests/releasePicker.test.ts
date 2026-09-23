import { PassThrough, Writable } from 'node:stream';
import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it } from 'vitest';
import { badge, CARD_WIDTH, releasePicker, renderInfoCard, sideBySide } from '../src/cli/releasePicker.js';
import type { VersionSummary } from '../src/core/types.js';

const labels = { sourceStatus: 'To be Deployed', targetStatus: 'Completed' };
const plain = (lines: string[]) => lines.map((l) => stripVTControlCharacters(l));

function summary(name: string, over: Partial<VersionSummary> = {}): VersionSummary {
  return {
    version: { id: name, name, released: false, archived: false, releaseDate: '2026-09-30' },
    statuses: [
      { name: 'To be Deployed', kind: 'source', count: 1 },
      { name: 'Completed', kind: 'target', count: 1 },
      { name: 'Test', kind: 'other', count: 3 },
    ],
    total: 5,
    pending: 1,
    done: 1,
    otherCount: 3,
    eligibility: 'blocked',
    ...over,
  };
}

describe('renderInfoCard', () => {
  it('tüm satırlar aynı genişlikte ve kenarlıklı', () => {
    const lines = plain(renderInfoCard(summary('Çok uzun bir release adı ki karta sığmayacak kadar uzun'), labels));
    expect(new Set(lines.map((l) => l.length))).toEqual(new Set([CARD_WIDTH]));
    expect(lines[0]).toMatch(/^┌─ /);
    expect(lines.at(-1)).toMatch(/^└─+┘$/);
  });

  it('uygun olmayan release için statü dağılımı ve uyarı gösterir', () => {
    const text = plain(renderInfoCard(summary('Management V.10-Revize'), labels)).join('\n');
    expect(text).toMatch(/To be Deployed\s+1/);
    expect(text).toMatch(/Test\s+3/);
    expect(text).toContain('UYGUN DEĞİL');
    expect(text).toContain('3 madde farklı statüde');
    expect(text).toContain('işlem başlatılamaz');
    expect(text).toContain('Açıklama');
  });

  it('uygun, hepsi tamam ve boş release metinleri', () => {
    const ready = summary('R', { eligibility: 'ready', otherCount: 0, pending: 20 });
    expect(plain(renderInfoCard(ready, labels)).join('\n')).toContain('20 madde "Completed" yapılacak');
    const allDone = summary('D', { eligibility: 'ready', otherCount: 0, pending: 0, done: 4 });
    expect(plain(renderInfoCard(allDone, labels)).join('\n')).toMatch(/Hepsi zaten "Completed",[\s\S]*release sadece kapatılır/);
    const empty = summary('E', { eligibility: 'empty', statuses: [], total: 0, pending: 0, done: 0, otherCount: 0 });
    const text = plain(renderInfoCard(empty, labels)).join('\n');
    expect(text).toContain("Bu release'te hiç madde yok");
    expect(text).toMatch(/UYGUN DEĞİL[\s\S]*Release'te madde yok/);
  });
});

describe('badge / sideBySide', () => {
  it('uygunluk durumuna göre işaret', () => {
    const b = (over: Partial<VersionSummary>) => stripVTControlCharacters(badge(summary('x', over)));
    expect(b({ eligibility: 'ready', pending: 2 })).toMatch(/✔|√/);
    expect(b({ eligibility: 'ready', pending: 2 })).toContain('2 bekliyor');
    expect(b({ eligibility: 'ready', pending: 0 })).toContain('hepsi tamam');
    expect(b({ eligibility: 'blocked' })).toContain('3 farklı statü');
    expect(b({ eligibility: 'empty' })).toContain('madde yok');
  });

  it('sol sütunu sabit genişliğe hizalar', () => {
    expect(sideBySide(['ab', 'c'], ['X', 'Y', 'Z'], 4)).toEqual(['ab    X', 'c     Y', '      Z']);
  });
});

describe('releasePicker', () => {
  function run(items: VersionSummary[], keys: string[]) {
    const input = new PassThrough() as PassThrough & { isTTY: boolean; setRawMode: () => void };
    input.isTTY = true;
    input.setRawMode = () => {};
    let screen = '';
    const output = new Writable({
      write(chunk, _enc, cb) {
        screen += chunk.toString();
        cb();
      },
    });
    const answer = releasePicker({ message: 'Seç', items, ...labels }, { input, output });
    // Prompt klavyeyi dinlemeye başladıktan sonra tuşları sırayla gönder
    void (async () => {
      for (const k of keys) {
        await new Promise((r) => setTimeout(r, 20));
        input.write(k);
      }
    })();
    return { answer, screen: () => stripVTControlCharacters(screen) };
  }

  it('oklarla gezip Enter ile seçer; uygun olmayan release de seçilebilir', async () => {
    const items = [summary('Uygun', { eligibility: 'ready', otherCount: 0 }), summary('Engelli')];
    const { answer, screen } = run(items, ['\x1b[B', '\r']);
    await expect(answer).resolves.toBe('Engelli');
    expect(screen()).toContain('┌─ Engelli');
  });

  it('harf yazınca eşleşen release\'e atlar', async () => {
    const { answer } = run([summary('Alfa'), summary('Beta'), summary('Gama')], ['g', '\r']);
    await expect(answer).resolves.toBe('Gama');
  });
});
