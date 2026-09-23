import { describe, expect, it } from 'vitest';
import { JiraClient, JiraError } from '../src/jira/client.js';
import { searchIssues } from '../src/jira/issues.js';
import { fakeFetch, issue, testJira } from './helpers.js';

describe('JiraClient', () => {
  it('429 durumunda Retry-After kadar bekleyip tekrar dener', async () => {
    let n = 0;
    const { fetchImpl } = fakeFetch({
      'GET /rest/api/3/myself': () =>
        ++n < 3 ? { status: 429, headers: { 'Retry-After': '2' } } : { body: { accountId: '1', displayName: 'Bot' } },
    });
    const waits: number[] = [];
    const jira = new JiraClient({ baseUrl: 'https://acme.atlassian.net', email: 'a@b.c', apiToken: 't', fetchImpl, sleep: async (ms) => void waits.push(ms) });
    const me = await jira.get<{ displayName: string }>('/rest/api/3/myself');
    expect(me.displayName).toBe('Bot');
    expect(waits).toEqual([2000, 2000]);
  });

  it('POST 5xx hatasında tekrar denemez (mükerrer işlem olmasın)', async () => {
    const { fetchImpl, calls } = fakeFetch({ 'POST /rest/api/3/issue/OE-1/comment': () => ({ status: 500 }) });
    await expect(testJira(fetchImpl).post('/rest/api/3/issue/OE-1/comment', {})).rejects.toBeInstanceOf(JiraError);
    expect(calls).toHaveLength(1);
  });

  it('GET 503 hatasında tekrar dener', async () => {
    let n = 0;
    const { fetchImpl, calls } = fakeFetch({
      'GET /rest/api/3/myself': () => (++n === 1 ? { status: 503 } : { body: { displayName: 'Bot' } }),
    });
    await testJira(fetchImpl).get('/rest/api/3/myself');
    expect(calls).toHaveLength(2);
  });

  it('401 için anlaşılır hata mesajı ve Jira detayları', async () => {
    const { fetchImpl } = fakeFetch({
      'GET /rest/api/3/myself': () => ({ status: 401, body: { errorMessages: ['Unauthorized'] } }),
    });
    await expect(testJira(fetchImpl).get('/rest/api/3/myself')).rejects.toThrow(/JIRA_API_TOKEN.*Unauthorized/);
  });
});

describe('searchIssues', () => {
  it('nextPageToken ile tüm sayfaları çeker', async () => {
    const { fetchImpl, calls } = fakeFetch({
      'POST /rest/api/3/search/jql': ({ body }) =>
        body.nextPageToken === 'p2'
          ? { body: { issues: [issue('OE-3', '1', 'X')], isLast: true } }
          : { body: { issues: [issue('OE-1', '1', 'X'), issue('OE-2', '1', 'X')], nextPageToken: 'p2' } },
    });
    const all = await searchIssues(testJira(fetchImpl), 'project = OE');
    expect(all.map((i) => i.key)).toEqual(['OE-1', 'OE-2', 'OE-3']);
    expect(calls).toHaveLength(2);
  });
});
