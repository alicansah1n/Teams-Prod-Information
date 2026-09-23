/** Jira Cloud yorumları Atlassian Document Format (ADF) bekler. Düz metni paragraflara çevirir. */
export function textToAdf(text: string) {
  return {
    type: 'doc',
    version: 1,
    content: text.split(/\r?\n/).map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : [],
    })),
  };
}
