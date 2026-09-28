/**
 * Links a task carries: the Jira ticket it implements, the PR it produced, the
 * design doc it follows, the CI run that is red.
 *
 * They live on the task, not in a transcript, because that is where they stay
 * true — a task outlives every session on it, and the ticket does not change
 * when the conversation is forked, compacted or replaced.
 *
 * Pure string work, so the judgement calls (what is a ticket, when are two URLs
 * the same link) are testable without a board.
 */

import { TaskLink, TaskLinkKind, TaskLinkSource } from '../types.js';

export const MAX_LINK_URL = 2_000;
export const MAX_LINK_TITLE = 200;
export const MAX_LINK_NOTE = 1_000;
/** A task that has collected this many links has a different problem. */
export const MAX_TASK_LINKS = 100;

/** Kinds that name a unit of tracked work — the ones worth lifting out of a prompt. */
export const TRACKER_KINDS: TaskLinkKind[] = ['jira', 'pr', 'issue'];

const KIND_LABEL: Record<TaskLinkKind, string> = {
  jira: 'Jira',
  pr: 'Pull request',
  issue: 'Issue',
  commit: 'Commit',
  doc: 'Doc',
  link: 'Link'
};

export function linkKindLabel(kind: TaskLinkKind): string {
  return KIND_LABEL[kind] || KIND_LABEL.link;
}

/** What a URL read out of prose wears from the sentence around it. */
export const TRAILING_PUNCTUATION = /[.,;:!?)\]}>'"]+$/;

/**
 * One canonical spelling of a URL, so the same page pasted twice is one link.
 *
 * Trailing punctuation is dropped because URLs are usually read out of prose,
 * where they end up wearing the sentence's full stop. Query and fragment are
 * kept: `#issuecomment-…` and `?selectedIssue=…` are the link, not decoration.
 */
export function normalizeLinkUrl(raw: string): string | null {
  const trimmed = (raw || '').trim().replace(/^<|>$/g, '').replace(TRAILING_PUNCTUATION, '');
  if (!trimmed || trimmed.length > MAX_LINK_URL) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname.includes('.')) return null;
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }
  return url.toString();
}

/**
 * A URL that is safe to put in an `href` someone else chose — an agent's
 * "open this to continue" link: http(s) and nothing else, so never
 * `javascript:`, `data:` or `file:`. Unlike `normalizeLinkUrl` it is kept
 * exactly as written.
 */
export function httpUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > MAX_LINK_URL) return undefined;
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

const GITHUB_NUMBERED =/^https?:\/\/(?:www\.)?github\.com\/([^/]+\/[^/]+)\/(pull|issues)\/(\d+)/i;
const GITHUB_COMMIT = /^https?:\/\/(?:www\.)?github\.com\/([^/]+\/[^/]+)\/commit\/([0-9a-f]{7,40})/i;
const JIRA_BROWSE = /\/browse\/([A-Z][A-Z0-9_]+-\d+)/;
const JIRA_SELECTED = /[?&](?:selectedIssue|issueKey)=([A-Z][A-Z0-9_]+-\d+)/;
const JIRA_ISSUE_PATH = /\/(?:issues|jira\/software\/(?:c\/)?projects\/[^/]+\/issues)\/([A-Z][A-Z0-9_]+-\d+)/;
const DOC_HOSTS = /(?:^|\.)(?:docs\.google\.com|notion\.so|notion\.site|figma\.com)$/i;

/**
 * What the URL points at, and the short reference people actually say out loud.
 * Unrecognised is not a failure — it is a 'link'.
 */
export function classifyLink(url: string): { kind: TaskLinkKind; ref?: string } {
  const numbered = GITHUB_NUMBERED.exec(url);
  if (numbered) {
    return {
      kind: numbered[2]!.toLowerCase() === 'pull' ? 'pr' : 'issue',
      ref: `${numbered[1]}#${numbered[3]}`
    };
  }

  const commit = GITHUB_COMMIT.exec(url);
  if (commit) return { kind: 'commit', ref: `${commit[1]}@${commit[2]!.slice(0, 7)}` };

  const jira = JIRA_BROWSE.exec(url) || JIRA_SELECTED.exec(url) || JIRA_ISSUE_PATH.exec(url);
  if (jira) return { kind: 'jira', ref: jira[1] };

  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    host = '';
  }
  if (DOC_HOSTS.test(host) || /\/wiki\//.test(url)) return { kind: 'doc' };

  return { kind: 'link' };
}

/** A readable stand-in when nobody supplied a title: the ref, else host + path. */
export function defaultLinkTitle(url: string, ref?: string): string {
  if (ref) return ref;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${parsed.hostname.replace(/^www\./, '')}${path}`.slice(0, MAX_LINK_TITLE);
  } catch {
    return url.slice(0, MAX_LINK_TITLE);
  }
}

export interface NewTaskLink {
  url: string;
  title?: string;
  note?: string;
  /** Overrides the kind detection — rarely needed, since the URL says it. */
  kind?: TaskLinkKind;
}

function clip(value: string | undefined, max: number): string | undefined {
  const text = (value || '').replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}

export function buildTaskLink(
  input: NewTaskLink,
  id: string,
  source: TaskLinkSource = 'user',
  now = Date.now()
): TaskLink | null {
  const url = normalizeLinkUrl(input.url);
  if (!url) return null;
  const detected = classifyLink(url);
  const kind = input.kind || detected.kind;
  return {
    id,
    url,
    title: clip(input.title, MAX_LINK_TITLE) || defaultLinkTitle(url, detected.ref),
    kind,
    ref: detected.ref,
    note: clip(input.note, MAX_LINK_NOTE),
    source,
    createdAt: now
  };
}

export interface TaskLinkMergeResult {
  links: TaskLink[];
  added: TaskLink[];
  updated: TaskLink[];
}

/**
 * Fold new links into the ones a task already has.
 *
 * The URL is the identity, so re-adding a ticket edits the entry that is there
 * rather than stacking a second copy — which is what makes it safe for the
 * agent to call the save tool with everything it knows every turn. A repeat
 * only overwrites fields it actually carries: a bare re-add of a link the user
 * has titled must not blank that title out.
 */
export function mergeTaskLinks(existing: TaskLink[] | undefined, incoming: TaskLink[]): TaskLinkMergeResult {
  const links = [...(existing || [])];
  const byUrl = new Map(links.map((link, index) => [link.url, index]));
  const added: TaskLink[] = [];
  const updated: TaskLink[] = [];

  for (const link of incoming) {
    const index = byUrl.get(link.url);
    if (index === undefined) {
      if (links.length >= MAX_TASK_LINKS) continue;
      byUrl.set(link.url, links.length);
      links.push(link);
      added.push(link);
      continue;
    }
    const current = links[index]!;
    const next: TaskLink = {
      ...current,
      title: link.title === defaultLinkTitle(link.url, link.ref) ? current.title : link.title,
      note: link.note ?? current.note,
      kind: link.kind,
      ref: link.ref ?? current.ref,
      updatedAt: link.createdAt
    };
    if (next.title === current.title && next.note === current.note && next.kind === current.kind) continue;
    links[index] = next;
    updated.push(next);
  }

  return { links, added, updated };
}

/**
 * `[text](url)` and a bare `https://…`. Exported because the composer scans
 * pasted text with the same two shapes — a URL is a URL wherever it is read,
 * and two copies of these would drift.
 */
export const MARKDOWN_LINK = /\[([^\]\n]*)\]\((<[^>\n]+>|[^)\s]+)(?:\s+"[^"]*")?\)/g;
export const BARE_URL = /\bhttps?:\/\/[^\s<>()[\]{}"'`]+/g;

/**
 * Tickets and PRs written into a piece of text — what the composer's mention
 * picker leaves behind as a Markdown link, and what a pasted URL looks like.
 *
 * Only tracker kinds are lifted. Every other URL in a prompt is a reference the
 * agent should read, not a property of the task, and hoovering those up would
 * turn the links panel into the prompt's bibliography.
 */
export function extractTrackerLinks(text: string): NewTaskLink[] {
  if (!text) return [];
  const found: NewTaskLink[] = [];
  const seen = new Set<string>();

  const take = (raw: string, title?: string) => {
    const url = normalizeLinkUrl(raw);
    if (!url || seen.has(url)) return;
    if (!TRACKER_KINDS.includes(classifyLink(url).kind)) return;
    seen.add(url);
    found.push({ url, title });
  };

  for (const match of text.matchAll(MARKDOWN_LINK)) {
    take(match[2]!.replace(/^<|>$/g, ''), match[1]);
  }
  for (const match of text.matchAll(BARE_URL)) {
    take(match[0]);
  }
  return found;
}

/**
 * The order refs identify a branch by: the ticket the work is tracked as first,
 * then the issue, and only then the PR — a PR is what the work produced, so it
 * is the weakest thing to name the branch that produces it after.
 */
const TICKET_KINDS: TaskLinkKind[] = ['jira', 'issue', 'pr'];

/** The tracked work a branch or worktree should be named after. */
export interface TicketRef {
  ref: string;
  kind: TaskLinkKind;
}

/** The ticket a task is against, when it has one. */
export function taskTicket(links: TaskLink[] | undefined): TicketRef | undefined {
  for (const kind of TICKET_KINDS) {
    const link = (links || []).find((entry) => entry.kind === kind && entry.ref);
    if (link?.ref) return { ref: link.ref, kind: link.kind };
  }
  return undefined;
}

/**
 * A key written straight into the text — `WEB-1234 login loops`. Only at the
 * very start of the first line, because that is where someone naming the work
 * puts it; anywhere else the shape is as likely to be `UTF-8` or `ISO-8601`.
 */
const LEADING_TICKET_KEY = /^\s*([A-Z][A-Z0-9_]+-\d+)\b/;

/** The ticket a piece of text is about — a pasted tracker URL, or a bare key. */
export function ticketInText(text: string): TicketRef | undefined {
  for (const found of extractTrackerLinks(text || '')) {
    const detected = classifyLink(found.url);
    if (detected.ref && TICKET_KINDS.includes(detected.kind)) {
      return { ref: detected.ref, kind: detected.kind };
    }
  }
  const key = LEADING_TICKET_KEY.exec(text || '');
  return key?.[1] ? { ref: key[1], kind: 'jira' } : undefined;
}

/** How the sidebar and the card order links: trackers first, newest last. */
export function sortTaskLinks(links: TaskLink[] | undefined): TaskLink[] {
  const rank = (link: TaskLink) => {
    const index = TRACKER_KINDS.indexOf(link.kind);
    return index === -1 ? TRACKER_KINDS.length : index;
  };
  return [...(links || [])].sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt);
}

/**
 * The links worth putting on a card: the tracked work the task is against.
 * A card has room for the ticket and the PR, not for a bibliography.
 */
export function trackerLinks(links: TaskLink[] | undefined, limit = 2): TaskLink[] {
  return sortTaskLinks(links)
    .filter((link) => TRACKER_KINDS.includes(link.kind))
    .slice(0, limit);
}

/**
 * Whether the ref is worth printing next to the title. It is not when the title
 * already opens with it — `WEB-1234 — WEB-1234 — Login loops` reads badly.
 */
export function showRef(link: Pick<TaskLink, 'ref' | 'title'>): boolean {
  return Boolean(link.ref) && !link.title.startsWith(link.ref!);
}

/** One link as the agent reads it back. */
export function formatTaskLink(link: TaskLink): string {
  const head = [`[${link.id}]`, linkKindLabel(link.kind), showRef(link) ? link.ref : '']
    .filter(Boolean)
    .join(' ');
  const lines = [`${head} — ${link.title}`, `  ${link.url}`];
  if (link.note) lines.push(`  note: ${link.note}`);
  return lines.join('\n');
}
