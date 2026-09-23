import { describe, expect, it } from 'vitest';
import type { ReleaseResult } from '../src/core/types.js';
import { buildReleaseCard } from '../src/teams/cards.js';
import { sendTeamsCard } from '../src/teams/webhookNotifier.js';
import { fakeFetch } from './helpers.js';

const ctx = { jiraBaseUrl: 'https://acme.atlassian.net', timeZone: 'Europe/Istanbul' };

function result(overrides: Partial<ReleaseResult> = {}): ReleaseResult {
  return {
    runId: 'r1',
    startedAt: '2026-09-23T11:30:00Z',
    finishedAt: '2026-09-23T11:31:00Z',
    project: { key: 'OE', name: 'Ozel Entegratorluk', displayName: 'Özel Entegratörlük' },
    version: { id: '100', name: '2026.09.1' },
    versionUrl: 'https://acme.atlassian.net/projects/OE/versions/100',
    deployedAt: '2026-09-23T11:30:00.000Z',
    releaseDate: '2026-09-23',
    triggeredBy: 'a.sahin',
    targetStatus: 'Completed',
    completed: [{ key: 'OE-1', summary: 'Fatura [PDF] hatası' }],
    failed: [],
    alreadyDone: [],
    ignored: [],
    versionRelease: { status: 'released' },
    ...overrides,
  };
}

const text = (card: unknown) => JSON.stringify(card);

describe('buildReleaseCard', () => {
  it('başarılı çıkış mesajı paket, sürüm, tarih ve saat içerir', () => {
    const t = text(buildReleaseCard(result(), ctx));
    expect(t).toContain('✅ Canlı Çıkış Tamamlandı');
    expect(t).toContain('**Özel Entegratörlük** paketindeki **2026.09.1** sürümü **23.09.2026 14:30** tarihinde canlıya çıkılmıştır.');
    expect(t).toContain('"style":"good"');
    expect(t).toContain('"title":"Completed yapılan","value":"1"');
    expect(t).toContain('"url":"https://acme.atlassian.net/projects/OE/versions/100"');
  });

  it('paket içeriğini (tamamlanan maddeleri) listelemez', () => {
    const completed = Array.from({ length: 50 }, (_, i) => ({ key: `OE-${i}`, summary: 'madde' }));
    const t = text(buildReleaseCard(result({ completed }), ctx));
    expect(t).not.toContain('Tamamlanan maddeler');
    expect(t).not.toContain('/browse/');
    expect(t).toContain('"value":"50"');
  });

  it('hata varsa uyarı kartı ve hatalı madde listesi', () => {
    const t = text(
      buildReleaseCard(
        result({ failed: [{ key: 'OE-2', summary: 'X', error: 'geçiş yok' }], versionRelease: { status: 'skipped', message: '1 madde tamamlanamadı' } }),
        ctx,
      ),
    );
    expect(t).toContain('Kontrol Gerekli');
    expect(t).toContain('Hatalı maddeler (1)');
    expect(t).toContain('"style":"warning"');
  });

  it('uzun hatalı madde listesini kısaltır', () => {
    const failed = Array.from({ length: 25 }, (_, i) => ({ key: `OE-${i}`, summary: 's', error: 'e' }));
    expect(text(buildReleaseCard(result({ failed }), ctx))).toContain('…ve 5 madde daha');
  });
});

describe('sendTeamsCard', () => {
  it('Workflows webhook formatında gönderir', async () => {
    const { fetchImpl, calls } = fakeFetch({ 'POST /workflows/hook': () => ({ status: 202 }) });
    await sendTeamsCard('https://prod.example.com/workflows/hook', buildReleaseCard(result(), ctx), { fetchImpl });
    expect(calls[0]!.body.type).toBe('message');
    expect(calls[0]!.body.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');
  });

  it('hata durumunda anlaşılır hata fırlatır', async () => {
    const { fetchImpl } = fakeFetch({ 'POST /workflows/hook': () => ({ status: 400, body: { error: 'bad' } }) });
    await expect(sendTeamsCard('https://prod.example.com/workflows/hook', buildReleaseCard(result(), ctx), { fetchImpl, sleep: async () => {} })).rejects.toThrow(/HTTP 400/);
  });
});
