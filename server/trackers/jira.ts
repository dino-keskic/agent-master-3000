import { MentionItem, clipComment, isJiraKey } from '../../shared/trackers/mentions.js';
import { adfToMarkdown } from '../../shared/trackers/adf.js';
import { NormalizedStatus, normalizeJiraStatus } from '../../shared/trackers/linkStatus.js';
import { runJson } from './cli.js';

/**
 * Everything that knows the shape of `acli` output.
 *
 * One work item is fetched three different ways — the search list, the
 * description, the comment thread — because `workitem view` only returns the
 * fields it is asked for, and asking for all of them makes the search slow.
 */

function jiraJql(query: string): string {
  const base = 'assignee = currentUser() AND statusCategory != Done';
  const q = query.trim();
  if (!q) return `${base} ORDER BY updated DESC`;
  const key = q.match(/^[A-Za-z][A-Za-z0-9]+-\d+$/);
  if (key) return `(${base} AND key = "${key[0].toUpperCase()}") OR key = "${key[0].toUpperCase()}" ORDER BY updated DESC`;
  const escaped = q.replace(/["\\]/g, ' ').trim();
  if (!escaped) return `${base} ORDER BY updated DESC`;
  return `${base} AND (summary ~ "${escaped}*" OR text ~ "${escaped}*") ORDER BY updated DESC`;
}

/** The Jira site to link tickets on, e.g. `JIRA_SITE=acme.atlassian.net`. */
function jiraSite(): string | undefined {
  const site = process.env.JIRA_SITE?.trim();
  if (!site) return undefined;
  return site.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function jiraUrl(site: string, key: string): string {
  return `https://${site}/browse/${key}`;
}

let warnedNoJiraSite = false;

export async function searchJira(query: string): Promise<MentionItem[]> {
  // No site, no links. Guessing one would point every ticket at a stranger's
  // Jira, so the search is skipped instead until the board is told where to look.
  const site = jiraSite();
  if (!site) {
    if (!warnedNoJiraSite) {
      warnedNoJiraSite = true;
      console.warn('[Mentions] JIRA_SITE is not set — Jira ticket search is off. Set it to e.g. acme.atlassian.net.');
    }
    return [];
  }
  const raw = await runJson('acli', [
    'jira',
    'workitem',
    'search',
    '--jql',
    jiraJql(query),
    '--limit',
    '20',
    '--json',
    '--fields',
    'key,summary,status,issuetype'
  ]);
  const rows = Array.isArray(raw) ? raw : [];
  const items: MentionItem[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const issue = row as { key?: string; fields?: { summary?: string; status?: { name?: string }; issuetype?: { name?: string } } };
    const key = issue.key?.trim();
    if (!key) continue;
    items.push({
      kind: 'jira',
      id: key,
      title: issue.fields?.summary?.trim() || key,
      url: jiraUrl(site, key),
      status: issue.fields?.status?.name,
      subtitle: issue.fields?.issuetype?.name
    });
  }
  return items;
}

/**
 * `acli jira workitem view`. The key comes from request bodies and pasted
 * links, so it is checked to be a key before it becomes an argument.
 */
function viewWorkItem(key: string, fields: string): Promise<unknown> {
  if (!isJiraKey(key)) return Promise.reject(new Error(`Not a Jira key: ${key.slice(0, 40)}`));
  return runJson('acli', ['jira', 'workitem', 'view', key, '--json', '--fields', fields]);
}

export async function jiraDescription(item: MentionItem): Promise<string> {
  const raw = await viewWorkItem(item.id, 'key,summary,status,issuetype,description');
  // `view` returns one work item; older acli builds wrap it in an array.
  const row = (Array.isArray(raw) ? raw[0] : raw) as { fields?: { description?: unknown } } | null;
  return adfToMarkdown(row?.fields?.description);
}

interface JiraComment {
  author?: { displayName?: string };
  created?: string;
  body?: unknown;
}

const JIRA_COMMENT_LIMIT = 50;

/**
 * Comments come off `workitem view`, not `comment list`. The list command
 * pre-flattens ADF to plain text: every list, link, code block and quote is
 * lost, and a comment that is only a screenshot arrives as an empty string.
 * The raw field is ADF, which `adfToMarkdown` already renders for descriptions.
 */
export async function jiraComments(item: MentionItem): Promise<string> {
  const raw = await viewWorkItem(item.id, 'comment');
  const row = (Array.isArray(raw) ? raw[0] : raw) as
    | { fields?: { comment?: { comments?: JiraComment[] } } }
    | null;
  const rows = (row?.fields?.comment?.comments || []).filter(Boolean);
  if (rows.length === 0) return 'No comments.';
  // Newest last, the way a thread reads; older ones drop off the top.
  return rows
    .slice(-JIRA_COMMENT_LIMIT)
    .map((comment) => {
      const who = comment.author?.displayName?.trim() || 'Unknown';
      const when = comment.created ? comment.created.slice(0, 10) : '';
      const body = clipComment(adfToMarkdown(comment.body));
      return `**${who}**${when ? ` — ${when}` : ''}\n${body || '_(no text — attachment or embed)_'}`;
    })
    .join('\n\n');
}

/** The state a linked ticket is in. Null when `acli` has no such issue. */
export async function jiraIssueStatus(key: string): Promise<{ title?: string; status: NormalizedStatus } | null> {
  const raw = await viewWorkItem(key, 'key,summary,status');
  const row = (Array.isArray(raw) ? raw[0] : raw) as {
    fields?: { summary?: string; status?: { name?: string; statusCategory?: { key?: string; name?: string } } };
  } | null;
  const status = row?.fields?.status;
  const normalized = normalizeJiraStatus(status?.name, status?.statusCategory?.key || status?.statusCategory?.name);
  if (!normalized) return null;
  return { title: row?.fields?.summary?.trim() || undefined, status: normalized };
}

/**
 * The one line behind a pasted Jira link. `JIRA_SITE` is deliberately not
 * consulted: the site is in the URL the user pasted, and having to configure
 * the board before a paste works would defeat the point of pasting.
 */
export async function resolveJira(item: MentionItem): Promise<MentionItem> {
  const raw = await viewWorkItem(item.id, 'key,summary,status,issuetype');
  const row = (Array.isArray(raw) ? raw[0] : raw) as
    | { key?: string; fields?: { summary?: string; status?: { name?: string }; issuetype?: { name?: string } } }
    | null;
  const title = row?.fields?.summary?.trim();
  if (!title) throw new Error(`No work item ${item.id}`);
  return {
    ...item,
    title,
    status: row?.fields?.status?.name || item.status,
    subtitle: row?.fields?.issuetype?.name || item.subtitle
  };
}
