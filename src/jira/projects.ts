import type { JiraClient } from './client.js';
import type { JiraProject, JiraStatus, JiraUser } from './types.js';

export function getMyself(jira: JiraClient): Promise<JiraUser> {
  return jira.get<JiraUser>('/rest/api/3/myself');
}

export function getProject(jira: JiraClient, projectKey: string): Promise<JiraProject> {
  return jira.get<JiraProject>(`/rest/api/3/project/${encodeURIComponent(projectKey)}`);
}

/** Projede kullanılan tüm statüler (issue type'lar arasında tekilleştirilmiş). */
export async function getProjectStatuses(jira: JiraClient, projectKey: string): Promise<JiraStatus[]> {
  const byType = await jira.get<{ statuses: JiraStatus[] }[]>(
    `/rest/api/3/project/${encodeURIComponent(projectKey)}/statuses`,
  );
  const unique = new Map<string, JiraStatus>();
  for (const t of byType) for (const s of t.statuses) unique.set(s.id, s);
  return [...unique.values()];
}

export async function getMyPermissions(
  jira: JiraClient,
  projectKey: string,
  permissions: string[],
): Promise<Record<string, boolean>> {
  const res = await jira.get<{ permissions: Record<string, { havePermission: boolean }> }>(
    '/rest/api/3/mypermissions',
    { projectKey, permissions: permissions.join(',') },
  );
  return Object.fromEntries(permissions.map((p) => [p, res.permissions[p]?.havePermission ?? false]));
}
