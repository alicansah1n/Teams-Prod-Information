type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
type Query = Record<string, string | number | boolean | undefined>;

export interface JiraClientOptions {
  baseUrl: string;
  email: string;
  apiToken: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class JiraError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: string[] = [],
  ) {
    super(details.length ? `${message}: ${details.join('; ')}` : message);
    this.name = 'JiraError';
  }
}

const MAX_RETRY_DELAY_MS = 60_000;

/**
 * Jira Cloud REST API istemcisi.
 * - Basic auth (e-posta + API token)
 * - 429 (rate limit) her istekte Retry-After'a uyarak tekrar denenir.
 * - 5xx ve ağ hataları yalnızca GET/PUT için tekrar denenir; POST tekrarlanırsa
 *   (yorum, geçiş) aynı işlem iki kez uygulanabileceği için tekrar edilmez.
 */
export class JiraClient {
  readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: JiraClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.authHeader = `Basic ${Buffer.from(`${opts.email}:${opts.apiToken}`).toString('base64')}`;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxRetries = opts.maxRetries ?? 4;
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  get<T>(path: string, query?: Query): Promise<T> {
    return this.request<T>('GET', path, { query });
  }

  post<T>(path: string, body: unknown, query?: Query): Promise<T> {
    return this.request<T>('POST', path, { body, query });
  }

  put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', path, { body });
  }

  async request<T>(method: HttpMethod, path: string, opts: { query?: Query; body?: unknown } = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const init: RequestInit = {
      method,
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    };
    const retrySafe = method === 'GET' || method === 'PUT';

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, init);
      } catch (err) {
        if (retrySafe && attempt < this.maxRetries) {
          await this.sleep(backoff(attempt));
          continue;
        }
        throw new JiraError(`Jira'ya bağlanılamadı (${method} ${path})`, 0, [(err as Error).message]);
      }

      const retryable = res.status === 429 || (retrySafe && res.status >= 500);
      if (retryable && attempt < this.maxRetries) {
        await this.sleep(retryDelay(res, attempt));
        continue;
      }
      if (!res.ok) throw await toJiraError(res, method, path);
      if (res.status === 204) return undefined as T;
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }
  }
}

function backoff(attempt: number): number {
  return Math.min(MAX_RETRY_DELAY_MS, 1000 * 2 ** attempt) + Math.floor(Math.random() * 250);
}

function retryDelay(res: Response, attempt: number): number {
  const header = res.headers.get('retry-after');
  const seconds = header ? Number(header) : NaN;
  return Number.isFinite(seconds) ? Math.min(MAX_RETRY_DELAY_MS, seconds * 1000) : backoff(attempt);
}

async function toJiraError(res: Response, method: string, path: string): Promise<JiraError> {
  const details: string[] = [];
  try {
    const body = (await res.json()) as { errorMessages?: string[]; errors?: Record<string, string> };
    details.push(...(body.errorMessages ?? []));
    for (const [field, msg] of Object.entries(body.errors ?? {})) details.push(`${field}: ${msg}`);
  } catch {
    // gövde JSON değil; durum koduyla yetin
  }
  const hint =
    {
      401: 'Kimlik doğrulama başarısız — JIRA_EMAIL / JIRA_API_TOKEN değerlerini kontrol edin',
      403: 'Bu işlem için Jira yetkiniz yok',
      404: 'Jira kaydı bulunamadı veya görme yetkiniz yok',
    }[res.status] ?? `Jira isteği başarısız (HTTP ${res.status})`;
  return new JiraError(`${hint} [${method} ${path}]`, res.status, details);
}
