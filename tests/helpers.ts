import { createConfig, type ConfigFile } from '../src/config.js';
import { JiraClient } from '../src/jira/client.js';

export interface FakeRequest {
  method: string;
  path: string;
  url: URL;
  body: any;
}
type FakeResponse = { status?: number; body?: unknown; headers?: Record<string, string> };
type Handler = (req: FakeRequest) => FakeResponse | Promise<FakeResponse>;

/** "METHOD /path" → handler eşlemesiyle çalışan sahte fetch; yapılan tüm çağrıları kaydeder. */
export function fakeFetch(routes: Record<string, Handler>) {
  const calls: FakeRequest[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const req = { method, path: url.pathname, url, body };
    calls.push(req);
    const handler = routes[`${method} ${url.pathname}`];
    if (!handler) {
      return new Response(JSON.stringify({ errorMessages: [`route yok: ${method} ${url.pathname}`] }), { status: 404 });
    }
    const r = await handler(req);
    const status = r.status ?? 200;
    return new Response(status === 204 || r.body === undefined ? null : JSON.stringify(r.body), {
      status,
      headers: r.headers,
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

export const TEST_ENV = {
  JIRA_BASE_URL: 'https://acme.atlassian.net',
  JIRA_EMAIL: 'bot@acme.com',
  JIRA_API_TOKEN: 'token',
  TZ_NAME: 'Europe/Istanbul',
  TRIGGERED_BY: 'tester',
};

export function testConfig(file: ConfigFile = { projects: { OE: { displayName: 'Özel Entegratörlük' } } }) {
  return createConfig(TEST_ENV, file);
}

export function testJira(fetchImpl: typeof fetch) {
  return new JiraClient({ ...testConfig().jira, fetchImpl, sleep: async () => {} });
}

export const status = (id: string, name: string) => ({ id, name });

export function issue(key: string, statusId: string, statusName: string, summary = `${key} özeti`) {
  return {
    id: key.replace(/\D/g, ''),
    key,
    fields: { summary, status: status(statusId, statusName), issuetype: { name: 'Task' }, assignee: null },
  };
}
