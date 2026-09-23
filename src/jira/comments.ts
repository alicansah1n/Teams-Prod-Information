import { textToAdf } from '../util/adf.js';
import type { JiraClient } from './client.js';

export async function addComment(jira: JiraClient, issueKey: string, text: string): Promise<void> {
  await jira.post(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, { body: textToAdf(text) });
}
