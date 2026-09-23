import type { JiraClient } from './client.js';
import type { JiraVersion } from './types.js';

interface VersionPage {
  values: JiraVersion[];
  isLast: boolean;
  startAt: number;
  maxResults: number;
}

export async function listVersions(
  jira: JiraClient,
  projectKey: string,
  opts: { status?: 'released' | 'unreleased' | 'archived' } = {},
): Promise<JiraVersion[]> {
  const all: JiraVersion[] = [];
  for (let startAt = 0; ; ) {
    const page = await jira.get<VersionPage>(`/rest/api/3/project/${encodeURIComponent(projectKey)}/version`, {
      startAt,
      maxResults: 50,
      status: opts.status,
      orderBy: '-sequence',
    });
    all.push(...page.values);
    if (page.isLast || page.values.length === 0) return all;
    startAt += page.values.length;
  }
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');

/** Release'i adına göre bulur: önce birebir, sonra büyük/küçük harf ve boşluk farkını yok sayarak. */
export async function findVersion(jira: JiraClient, projectKey: string, name: string): Promise<JiraVersion | undefined> {
  const versions = await listVersions(jira, projectKey);
  return versions.find((v) => v.name === name) ?? versions.find((v) => norm(v.name) === norm(name));
}

export function updateVersion(
  jira: JiraClient,
  versionId: string,
  body: { released?: boolean; releaseDate?: string; description?: string },
): Promise<JiraVersion> {
  return jira.put<JiraVersion>(`/rest/api/3/version/${encodeURIComponent(versionId)}`, body);
}

export function versionUrl(baseUrl: string, projectKey: string, versionId: string): string {
  return `${baseUrl}/projects/${encodeURIComponent(projectKey)}/versions/${encodeURIComponent(versionId)}`;
}
