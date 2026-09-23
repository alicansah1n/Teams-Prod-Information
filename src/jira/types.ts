export interface JiraStatus {
  id: string;
  name: string;
  statusCategory?: { key: string; name: string };
}

export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    status: JiraStatus;
    issuetype?: { name: string };
    assignee?: { displayName: string } | null;
    fixVersions?: { id: string; name: string }[];
  };
}

export interface JiraVersion {
  id: string;
  name: string;
  description?: string;
  released: boolean;
  archived: boolean;
  releaseDate?: string;
  projectId?: number;
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
}

export interface JiraTransitionField {
  required: boolean;
  hasDefaultValue?: boolean;
  name: string;
}

export interface JiraTransition {
  id: string;
  name: string;
  to: JiraStatus;
  fields?: Record<string, JiraTransitionField>;
}

export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
}

/** Uygulama içinde taşınan sadeleştirilmiş madde bilgisi */
export interface IssueSummary {
  key: string;
  summary: string;
  status: string;
  statusId: string;
  issueType?: string;
  assignee?: string;
}

export function toIssueSummary(issue: JiraIssue): IssueSummary {
  return {
    key: issue.key,
    summary: issue.fields.summary,
    status: issue.fields.status.name,
    statusId: issue.fields.status.id,
    issueType: issue.fields.issuetype?.name,
    assignee: issue.fields.assignee?.displayName,
  };
}
