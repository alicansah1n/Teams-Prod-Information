import type { AdaptiveCard } from './cards.js';

export interface NotifierOptions {
  fetchImpl?: typeof fetch;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Teams "Workflows" webhook'una ("Post to a channel when a webhook request is received")
 * Adaptive Card gönderir. Entra ID uygulama kaydı veya admin onayı gerektirmez.
 */
export async function sendTeamsCard(webhookUrl: string, card: AdaptiveCard, opts: NotifierOptions = {}): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const retries = opts.retries ?? 2;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const body = JSON.stringify({
    type: 'message',
    attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: card }],
  });

  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    if (res.ok) return;
    // Sadece isteğin işlenmediği kesin olan durumlarda tekrar dene (mükerrer mesaj olmasın).
    if ((res.status === 429 || res.status === 503) && attempt < retries) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    const text = await res.text().catch(() => '');
    throw new Error(`Teams webhook isteği başarısız (HTTP ${res.status})${text ? `: ${text.slice(0, 300)}` : ''}`);
  }
}
