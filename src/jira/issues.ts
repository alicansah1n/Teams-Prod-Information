import type { JiraClient } from './client.js';
import type { JiraIssue } from './types.js';

interface SearchPage {
  issues: JiraIssue[];
  nextPageToken?: string;
  isLast?: boolean;
}

const DEFAULT_FIELDS = ['summary', 'status', 'issuetype', 'assignee'];

/** Yeni Jira Cloud arama API'si (/search/jql) ile token tabanlı sayfalama yaparak tüm sonuçları döner. */
export async function searchIssues(jira: JiraClient, jql: string, fields = DEFAULT_FIELDS): Promise<JiraIssue[]> {
  const all: JiraIssue[] = [];
  let nextPageToken: string | undefined;
  do {
    const page = await jira.post<SearchPage>('/rest/api/3/search/jql', {
      jql,
      fields,
      maxResults: 100,
      ...(nextPageToken ? { nextPageToken } : {}),
    });
    all.push(...page.issues);
    nextPageToken = page.isLast === true ? undefined : page.nextPageToken;
  } while (nextPageToken);
  return all;
}

/** JQL içinde tırnaklı değer olarak güvenle kullanılabilir hale getirir. */
export function jqlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function getVersionIssues(jira: JiraClient, projectKey: string, versionId: string): Promise<JiraIssue[]> {
  return searchIssues(jira, `project = ${jqlString(projectKey)} AND fixVersion = ${versionId} ORDER BY key ASC`);
}

export function issueUrl(baseUrl: string, key: string): string {
  return `${baseUrl}/browse/${encodeURIComponent(key)}`;
}
