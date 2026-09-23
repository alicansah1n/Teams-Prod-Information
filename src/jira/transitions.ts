import type { JiraClient } from './client.js';
import type { JiraTransition } from './types.js';

export async function getTransitions(jira: JiraClient, issueKey: string): Promise<JiraTransition[]> {
  const res = await jira.get<{ transitions: JiraTransition[] }>(
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
    { expand: 'transitions.fields' },
  );
  return res.transitions;
}

export const normalizeStatus = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');

export function statusMatches(status: { id: string; name: string }, target: { name: string; id?: string }): boolean {
  return target.id ? status.id === target.id : normalizeStatus(status.name) === normalizeStatus(target.name);
}

/**
 * Geçişi adına göre değil, HEDEF statüsüne göre seçer; böylece workflow'daki
 * geçiş adları ("Deploy Done", "Tamamla" vb.) değişse de doğru geçiş bulunur.
 */
export function selectTransition(
  transitions: JiraTransition[],
  target: { name: string; id?: string },
): JiraTransition | undefined {
  return transitions.find((t) => statusMatches(t.to, target));
}

/** Geçiş ekranında zorunlu olup varsayılanı olmayan ve config'te de verilmemiş alanlar. */
export function missingRequiredFields(transition: JiraTransition, provided: Record<string, unknown>): string[] {
  return Object.entries(transition.fields ?? {})
    .filter(([id, f]) => f.required && !f.hasDefaultValue && !(id in provided))
    .map(([id, f]) => `${f.name} (${id})`);
}

/** Jira, geçiş ekranında olmayan alan gönderilirse hata verir; sadece ekrandaki alanları gönder. */
export function fieldsForTransition(
  transition: JiraTransition,
  provided: Record<string, unknown>,
): Record<string, unknown> {
  const onScreen = transition.fields ?? {};
  return Object.fromEntries(Object.entries(provided).filter(([id]) => id in onScreen));
}

export async function doTransition(
  jira: JiraClient,
  issueKey: string,
  transitionId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await jira.post(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
    transition: { id: transitionId },
    ...(Object.keys(fields).length ? { fields } : {}),
  });
}
