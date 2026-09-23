import { describe, expect, it } from 'vitest';
import type { ConfigFile } from '../src/config.js';
import { ReleaseService, withDeployNote } from '../src/core/releaseService.js';
import { planBlockers } from '../src/core/types.js';
import type { JiraTransition } from '../src/jira/types.js';
import { fakeFetch, issue, testConfig, testJira } from './helpers.js';

const TBD = ['10', 'To be Deployed'] as const;
const DONE = ['20', 'Completed'] as const;

const toCompleted = (fields?: JiraTransition['fields']): JiraTransition => ({
  id: '31',
  name: 'Deploy Done',
  to: { id: DONE[0], name: DONE[1] },
  fields,
});

interface Scenario {
  issues: ReturnType<typeof issue>[];
  transitions: Record<string, JiraTransition[]>;
  released?: boolean;
  config?: ConfigFile;
  /** Bu maddelerin geçiş isteği Jira'da hata versin (plan sonrası oluşan hata) */
  failTransition?: string[];
}

function setup(s: Scenario) {
  const { fetchImpl, calls } = fakeFetch({
    'GET /rest/api/3/project/OE': () => ({ body: { id: '1', key: 'OE', name: 'Ozel Entegratorluk' } }),
    'GET /rest/api/3/project/OE/version': () => ({
      body: {
        values: [
          { id: '99', name: '2026.09.0', released: true, archived: false },
          { id: '100', name: '2026.09.1', released: s.released ?? false, archived: false, description: 'Eylül paketi' },
        ],
        isLast: true,
      },
    }),
    'POST /rest/api/3/search/jql': () => ({ body: { issues: s.issues, isLast: true } }),
    ...Object.fromEntries(
      Object.entries(s.transitions).map(([key, t]) => [
        `GET /rest/api/3/issue/${key}/transitions`,
        () => ({ body: { transitions: t } }),
      ]),
    ),
    ...Object.fromEntries(
      s.issues.flatMap((i) => [
        [
          `POST /rest/api/3/issue/${i.key}/transitions`,
          () => (s.failTransition?.includes(i.key) ? { status: 403, body: { errorMessages: ['yetki yok'] } } : { status: 204 }),
        ],
        [`POST /rest/api/3/issue/${i.key}/comment`, () => ({ status: 201, body: { id: '1' } })],
      ]),
    ),
    'PUT /rest/api/3/version/100': ({ body }) => ({ body: { id: '100', ...body } }),
  });
  const service = new ReleaseService({
    jira: testJira(fetchImpl),
    config: testConfig(s.config),
    now: () => new Date('2026-09-23T11:30:00Z'), // İstanbul 14:30
  });
  return { service, calls };
}

const writes = (calls: { method: string; path: string }[]) =>
  calls.filter((c) => c.method !== 'GET' && !c.path.endsWith('/search/jql')).map((c) => `${c.method} ${c.path}`);

describe('ReleaseService', () => {
  it('maddeleri statülerine göre doğru gruplar ve sorunları onaydan önce tespit eder', async () => {
    const { service, calls } = setup({
      issues: [issue('OE-1', ...TBD), issue('OE-2', ...TBD), issue('OE-3', ...DONE), issue('OE-4', '5', 'In Test')],
      transitions: { 'OE-1': [toCompleted()], 'OE-2': [{ id: '7', name: 'Reopen', to: { id: '1', name: 'Open' } }] },
    });
    const plan = await service.plan({ projectKey: 'oe', versionName: '2026.09.1' });

    expect(plan.project.displayName).toBe('Özel Entegratörlük');
    expect(plan.version.id).toBe('100');
    expect(plan.ready.map((p) => p.issue.key)).toEqual(['OE-1']);
    expect(plan.blocked.map((b) => b.issue.key)).toEqual(['OE-2']);
    expect(plan.blocked[0]!.reason).toMatch(/doğrudan geçiş yok.*Reopen → Open/);
    expect(plan.alreadyDone.map((i) => i.key)).toEqual(['OE-3']);
    expect(plan.otherStatus.map((i) => i.key)).toEqual(['OE-4']);
    expect(planBlockers(plan)).toHaveLength(2);
    expect(writes(calls)).toEqual([]); // plan hiçbir şeyi değiştirmez
  });

  it('release\'te başka statüde tek bir madde bile varsa HİÇBİR şey yapılmaz', async () => {
    const { service, calls } = setup({
      issues: [issue('OE-1', ...TBD), issue('OE-2', ...DONE), issue('OE-3', '5', 'Test')],
      transitions: { 'OE-1': [toCompleted()] },
    });
    const plan = await service.plan({ projectKey: 'OE', versionName: '2026.09.1' });
    expect(planBlockers(plan)[0]).toMatch(/statüde 1 madde var \(Test\)/);
    await expect(service.execute(plan)).rejects.toThrow(/hiçbir şey değiştirilmedi/);
    expect(writes(calls)).toEqual([]);
  });

  it('geçirilemeyen bir To be Deployed maddesi varsa HİÇBİR şey yapılmaz', async () => {
    const { service, calls } = setup({
      issues: [issue('OE-1', ...TBD), issue('OE-2', ...TBD)],
      transitions: { 'OE-1': [toCompleted()], 'OE-2': [] },
    });
    await expect(service.execute(await service.plan({ projectKey: 'OE', versionName: '2026.09.1' }))).rejects.toThrow(
      /geçirilemeyen 1 madde/,
    );
    expect(writes(calls)).toEqual([]);
  });

  it('config allowedStatuses içindeki statüler engel olmaz ve onlara dokunulmaz', async () => {
    const { service, calls } = setup({
      issues: [issue('OE-1', ...TBD), issue('OE-2', '7', 'Canceled')],
      transitions: { 'OE-1': [toCompleted()] },
      config: { projects: { OE: { allowedStatuses: ['canceled'] } } },
    });
    const plan = await service.plan({ projectKey: 'OE', versionName: '2026.09.1' });
    expect(plan.ignored.map((i) => i.key)).toEqual(['OE-2']);
    const result = await service.execute(plan);
    expect(result.versionRelease.status).toBe('released');
    expect(calls.some((c) => c.path.startsWith('/rest/api/3/issue/OE-2') && c.method === 'POST')).toBe(false);
  });

  it('önizleme ile onay arasında bir maddenin statüsü değişirse hiçbir şey yapılmaz', async () => {
    const s: Scenario = { issues: [issue('OE-1', ...TBD), issue('OE-2', ...TBD)], transitions: { 'OE-1': [toCompleted()], 'OE-2': [toCompleted()] } };
    const { service, calls } = setup(s);
    const plan = await service.plan({ projectKey: 'OE', versionName: '2026.09.1' });
    s.issues[1] = issue('OE-2', '5', 'Test'); // biri Jira'da maddeyi Test'e geri aldı
    await expect(service.execute(plan)).rejects.toThrow(/Önizlemeden sonra.*OE-2 \(Test\)/s);
    expect(writes(calls)).toEqual([]);
  });

  it('önizleme sonrası release\'e yeni madde eklenirse hiçbir şey yapılmaz', async () => {
    const s: Scenario = { issues: [issue('OE-1', ...TBD)], transitions: { 'OE-1': [toCompleted()] } };
    const { service, calls } = setup(s);
    const plan = await service.plan({ projectKey: 'OE', versionName: '2026.09.1' });
    s.issues.push(issue('OE-9', ...TBD));
    await expect(service.execute(plan)).rejects.toThrow(/OE-9/);
    expect(writes(calls)).toEqual([]);
  });

  it('onaydan sonra Jira bir geçişi reddederse release kapatılmaz, durum raporlanır', async () => {
    const { service } = setup({
      issues: [issue('OE-1', ...TBD), issue('OE-2', ...TBD)],
      transitions: { 'OE-1': [toCompleted()], 'OE-2': [toCompleted()] },
      failTransition: ['OE-2'],
    });
    const result = await service.execute(await service.plan({ projectKey: 'OE', versionName: '2026.09.1' }));

    expect(result.completed.map((i) => i.key)).toEqual(['OE-1']);
    expect(result.failed.map((i) => i.key)).toEqual(['OE-2']);
    expect(result.failed[0]!.error).toMatch(/yetki yok/);
    expect(result.versionRelease.status).toBe('skipped');
  });

  it('her şey başarılıysa release tarih ve saat notuyla Released yapılır', async () => {
    const { service, calls } = setup({
      issues: [issue('OE-1', ...TBD), issue('OE-2', ...TBD)],
      transitions: { 'OE-1': [toCompleted()], 'OE-2': [toCompleted()] },
    });
    const result = await service.execute(await service.plan({ projectKey: 'OE', versionName: '2026.09.1' }));

    expect(result.completed).toHaveLength(2);
    expect(result.versionRelease.status).toBe('released');
    expect(result.releaseDate).toBe('2026-09-23');
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.body).toEqual({ released: true, releaseDate: '2026-09-23', description: 'Eylül paketi | Canlı çıkış: 23.09.2026 14:30' });
    const comment = calls.find((c) => c.path === '/rest/api/3/issue/OE-1/comment')!;
    expect(JSON.stringify(comment.body)).toContain('Bu madde 23.09.2026 14:30 tarihinde 2026.09.1 sürümü ile canlıya alınmıştır.');
    const transition = calls.find((c) => c.path === '/rest/api/3/issue/OE-1/transitions' && c.method === 'POST')!;
    expect(transition.body).toEqual({ transition: { id: '31' } });
  });

  it('--date ile verilen zaman ve --no-comment dikkate alınır', async () => {
    const { service, calls } = setup({ issues: [issue('OE-1', ...TBD)], transitions: { 'OE-1': [toCompleted()] } });
    const plan = await service.plan({ projectKey: 'OE', versionName: '2026.09.1', deployedAt: new Date('2026-09-20T19:00:00Z') });
    const result = await service.execute(plan, { comment: false });
    expect(result.releaseDate).toBe('2026-09-20');
    expect(calls.some((c) => c.path.endsWith('/comment'))).toBe(false);
  });

  it('zorunlu geçiş alanı config ile doldurulur, doldurulmazsa madde bloklanır', async () => {
    const fields = { resolution: { required: true, name: 'Resolution' } };
    const base = { issues: [issue('OE-1', ...TBD)], transitions: { 'OE-1': [toCompleted(fields)] } };

    const blocked = await setup(base).service.plan({ projectKey: 'OE', versionName: '2026.09.1' });
    expect(blocked.blocked[0]!.reason).toMatch(/Resolution/);

    const { service, calls } = setup({
      ...base,
      config: { projects: { OE: { transitionFields: { resolution: { name: 'Done' }, customfield_9: 'x' } } } },
    });
    await service.execute(await service.plan({ projectKey: 'OE', versionName: '2026.09.1' }));
    const transition = calls.find((c) => c.method === 'POST' && c.path.endsWith('/transitions'))!;
    expect(transition.body).toEqual({ transition: { id: '31' }, fields: { resolution: { name: 'Done' } } });
  });

  it('hepsi To be Deployed ise hepsi Completed yapılır ve release kapatılır', async () => {
    const { service, calls } = setup({
      issues: [issue('OE-1', ...TBD), issue('OE-2', ...TBD)],
      transitions: { 'OE-1': [toCompleted()], 'OE-2': [toCompleted()] },
    });
    const result = await service.execute(await service.plan({ projectKey: 'OE', versionName: '2026.09.1' }));
    expect(result.completed).toHaveLength(2);
    expect(result.versionRelease.status).toBe('released');
    expect(calls.filter((c) => c.method === 'POST' && c.path.endsWith('/transitions'))).toHaveLength(2);
  });

  it('hepsi Completed ise işlem yapılır: madde değişmez, sadece release kapatılır', async () => {
    const { service, calls } = setup({ issues: [issue('OE-1', ...DONE), issue('OE-2', ...DONE)], transitions: {} });
    const plan = await service.plan({ projectKey: 'OE', versionName: '2026.09.1' });
    expect(planBlockers(plan)).toEqual([]);
    const result = await service.execute(plan);
    expect(result.completed).toHaveLength(0);
    expect(result.alreadyDone).toHaveLength(2);
    expect(result.versionRelease.status).toBe('released');
    expect(writes(calls)).toEqual(['PUT /rest/api/3/version/100']);
  });

  it('tekrar çalıştırmak güvenli: hepsi Completed ve release zaten kapalıysa Jira\'ya yazılmaz', async () => {
    const { service, calls } = setup({ issues: [issue('OE-1', ...DONE)], transitions: {}, released: true });
    const result = await service.execute(await service.plan({ projectKey: 'OE', versionName: '2026.09.1' }));
    expect(result.versionRelease.status).toBe('already-released');
    expect(writes(calls)).toEqual([]);
  });

  it('release\'te hiç madde yoksa uygun değil, hiçbir şey yapılmaz', async () => {
    const { service, calls } = setup({ issues: [], transitions: {} });
    const plan = await service.plan({ projectKey: 'OE', versionName: '2026.09.1' });
    expect(planBlockers(plan)[0]).toMatch(/hiç madde yok/);
    await expect(service.execute(plan)).rejects.toThrow(/hiç madde yok/);
    expect(writes(calls)).toEqual([]);
  });

  it('release listesini statü dağılımıyla özetler, uygun olanlar üstte', async () => {
    const withVersions = (i: ReturnType<typeof issue>, ...ids: string[]) => ({
      ...i,
      fields: { ...i.fields, fixVersions: ids.map((id) => ({ id, name: id })) },
    });
    const { fetchImpl } = fakeFetch({
      'GET /rest/api/3/project/OE/version': () => ({
        body: {
          isLast: true,
          values: [
            { id: 'A', name: 'Bos', released: false, archived: false },
            { id: 'B', name: 'Engelli', released: false, archived: false },
            { id: 'C', name: 'Uygun', released: false, archived: false },
            { id: 'D', name: 'Arsiv', released: false, archived: true },
            { id: 'E', name: 'HepsiTamam', released: false, archived: false },
          ],
        },
      }),
      'POST /rest/api/3/search/jql': () => ({
        body: {
          isLast: true,
          issues: [
            withVersions(issue('OE-1', ...TBD), 'B', 'C'),
            withVersions(issue('OE-2', '5', 'Test'), 'B'),
            withVersions(issue('OE-3', '5', 'Test'), 'B'),
            withVersions(issue('OE-4', ...DONE), 'C'),
            withVersions(issue('OE-5', '7', 'Canceled'), 'C'),
            withVersions(issue('OE-6', ...DONE), 'E'),
          ],
        },
      }),
    });
    const service = new ReleaseService({
      jira: testJira(fetchImpl),
      config: testConfig({ projects: { OE: { allowedStatuses: ['Canceled'] } } }),
    });
    const list = await service.listVersionSummaries('OE');

    expect(list.map((s) => [s.version.name, s.eligibility])).toEqual([
      ['Uygun', 'ready'],
      ['HepsiTamam', 'ready'],
      ['Engelli', 'blocked'],
      ['Bos', 'empty'],
    ]);
    const blocked = list[2]!;
    expect(blocked.statuses).toEqual([
      { name: 'To be Deployed', kind: 'source', count: 1 },
      { name: 'Test', kind: 'other', count: 2 },
    ]);
    expect(blocked).toMatchObject({ pending: 1, done: 0, otherCount: 2, total: 3 });
    expect(list[1]).toMatchObject({ pending: 0, done: 1, otherCount: 0 });
    expect(list[0]!.statuses.map((s) => s.kind)).toEqual(['source', 'target', 'allowed']);
  });

  it('bulunamayan release için anlaşılır hata', async () => {
    const { service } = setup({ issues: [], transitions: {} });
    await expect(service.plan({ projectKey: 'OE', versionName: '9.9.9' })).rejects.toThrow(/bulunamadı/);
  });

  it('release adı büyük/küçük harf ve boşluk farkına toleranslı', async () => {
    const { service } = setup({ issues: [], transitions: {} });
    const plan = await service.plan({ projectKey: 'OE', versionName: ' 2026.09.1 ' });
    expect(plan.version.id).toBe('100');
  });
});

describe('withDeployNote', () => {
  it('eski notu değiştirir, yoksa ekler', () => {
    expect(withDeployNote(undefined, 'Canlı çıkış: 23.09.2026 14:30')).toBe('Canlı çıkış: 23.09.2026 14:30');
    expect(withDeployNote('Paket | Canlı çıkış: 01.01.2026 10:00', 'Canlı çıkış: 23.09.2026 14:30')).toBe(
      'Paket | Canlı çıkış: 23.09.2026 14:30',
    );
  });
});
