import { BARE_URL, MARKDOWN_LINK, TRAILING_PUNCTUATION, classifyLink, normalizeLinkUrl } from '../task/links.js';

export type MentionKind = 'jira' | 'github' | 'run';

export interface MentionItem {
  kind: MentionKind;
  /**
   * The ticket key or PR reference, e.g. `WEB-1234` or `web-app#9404`.
   * GitHub's own `repo#number` notation is kept — it is how the PR is written
   * everywhere else. An Actions run is `web-app/runs/123`, plus `/job/456`
   * when the link was to one job. No spaces: it names the fetched blocks.
   */
  id: string;
  title: string;
  url: string;
  status?: string;
  subtitle?: string;
}

/** A repo file offered by `@`. */
export interface FileItem {
  /** Path relative to the session's working directory. */
  path: string;
  /** Basename, split out so the menu can weight it. */
  name: string;
}

/**
 * The extra context a ticket, PR or run can be asked for, on top of the link.
 * `description` is the one fetched on the pick; for a run that is its summary
 * — the jobs and which steps failed — and the full job list and the failed
 * logs are the "fetch everything" buttons.
 */
export type MentionExtra = 'description' | 'comments' | 'checks' | 'jobs' | 'logs';

export interface MentionExtraSpec {
  id: MentionExtra;
  label: string;
  kinds: MentionKind[];
}

interface ExtraDefinition extends MentionExtraSpec {
  /** What the chip says for a kind where the generic word would mislead. */
  labelFor?: Partial<Record<MentionKind, string>>;
}

export const MENTION_EXTRAS: ExtraDefinition[] = [
  { id: 'description', label: 'description', kinds: ['jira', 'github', 'run'], labelFor: { run: 'summary' } },
  { id: 'comments', label: 'comments', kinds: ['jira', 'github'] },
  { id: 'checks', label: 'checks', kinds: ['github'] },
  { id: 'jobs', label: 'all jobs', kinds: ['run'] },
  { id: 'logs', label: 'failed logs', kinds: ['run'] }
];

export function extrasForKind(kind: MentionKind): MentionExtraSpec[] {
  return MENTION_EXTRAS.filter((extra) => extra.kinds.includes(kind)).map(({ id, label, kinds, labelFor }) => ({
    id,
    kinds,
    label: labelFor?.[kind] ?? label
  }));
}

const KIND_LABEL: Record<MentionKind, string> = { jira: 'Jira', github: 'GitHub PR', run: 'Actions run' };

/**
 * A kind as it arrives in a request body. Anything unknown is Jira, which
 * checks its key before `acli` sees it.
 */
export function parseMentionKind(value: unknown): MentionKind {
  return value === 'github' || value === 'run' ? value : 'jira';
}

/** Kinds that are looked up by their URL — `gh` reads the repo back out of it. */
export function mentionNeedsUrl(kind: MentionKind): boolean {
  return kind !== 'jira';
}

export function mentionLabel(item: MentionItem): string {
  return `${KIND_LABEL[item.kind]} ${item.id}`;
}

export function mentionRef(item: MentionItem): string {
  return `${item.kind}:${item.id}`;
}

/**
 * What a picked ticket or PR drops into the composer: one Markdown link, and
 * nothing else. The description is fetched straight away and the comments and
 * CI checks on request, but none of it lands in the box — pasting a ticket
 * into the text buried the sentence the user was in the middle of writing.
 */
export function mentionLink(item: MentionItem): string {
  const text = item.title.trim() ? `${item.id} — ${item.title.trim()}` : item.id;
  return `[${text.replace(/[[\]]/g, '')}](${item.url})`;
}

/** What a picked file drops in — the bare path, as every agent chat writes it. */
export function fileMention(file: FileItem): string {
  return `@${file.path}`;
}

/* ------------------------------------------------------------------ *
 * Pasted links.
 *
 * A ticket or PR URL dropped into the composer means the same thing as one
 * picked from the `@` menu, so it is treated the same way: written in as a
 * Markdown link, then resolved for its title and description. Typing `@` to
 * find something you already have in the clipboard is a step nobody should
 * have to take.
 * ------------------------------------------------------------------ */

/**
 * The ticket, PR or Actions run behind a URL, or null.
 *
 * Only what the fetchers can actually follow counts: Jira work items, GitHub
 * pull requests and workflow runs. A GitHub issue, a commit, a design doc — all fine
 * links, none of them things there is a description to go and get, so they
 * are left as whatever the user pasted.
 *
 * The title comes back empty. It is not in the URL, and inventing one would
 * put a wrong name in the prompt; `resolveMention` fills it in afterwards,
 * and until it does the link reads as the ref, which is what the user pasted
 * anyway.
 */
export function mentionFromUrl(raw: string): MentionItem | null {
  const url = normalizeLinkUrl(raw);
  if (!url) return null;
  const { kind, ref } = classifyLink(url);
  if (!ref) return null;
  if (kind === 'jira') return { kind: 'jira', id: ref, title: '', url };
  if (kind === 'pr') {
    // `classifyLink` gives `owner/name#9404`; a mention id is the short
    // `name#9404` the PR is called by, with the owner kept as the subtitle.
    const [repo = '', number = ''] = ref.split('#');
    if (!repo || !number) return null;
    return { kind: 'github', id: `${repo.split('/')[1] || repo}#${number}`, title: '', url, subtitle: repo };
  }
  if (kind === 'run') {
    const run = parseRunUrl(url);
    if (!run) return null;
    const name = run.repo.split('/')[1] || run.repo;
    const id = `${name}/runs/${run.runId}${run.jobId ? `/job/${run.jobId}` : ''}`;
    return { kind: 'run', id, title: '', url, subtitle: run.repo };
  }
  return null;
}

export interface LinkifyResult {
  text: string;
  /** Recognised items, in the order they appear, deduped by ref. */
  items: MentionItem[];
}

/**
 * Rewrite the bare tracker URLs in a piece of text as Markdown links.
 *
 * URLs already inside a Markdown link are left alone — they have a title
 * someone chose, and relinking them would nest brackets. Everything that is
 * not a ticket or a PR is left alone too: the text comes back unchanged and
 * the caller can let the paste happen normally.
 */
export function linkifyMentionUrls(text: string): LinkifyResult {
  if (!text) return { text, items: [] };

  // Spans already spoken for by `[text](url)`, so a link is not linked twice.
  const taken: Array<[number, number]> = [];
  for (const match of text.matchAll(MARKDOWN_LINK)) {
    taken.push([match.index, match.index + match[0].length]);
  }
  const inside = (at: number) => taken.some(([from, to]) => at >= from && at < to);

  const items: MentionItem[] = [];
  const seen = new Set<string>();
  let out = '';
  let cursor = 0;

  for (const match of text.matchAll(BARE_URL)) {
    const at = match.index;
    if (inside(at)) continue;
    // The match runs to the next space, so it carries any punctuation the
    // sentence ended with. That belongs to the prose, not the URL.
    const raw = match[0].replace(TRAILING_PUNCTUATION, '');
    if (!raw) continue;
    const item = mentionFromUrl(raw);
    if (!item) continue;

    out += text.slice(cursor, at) + mentionLink(item);
    cursor = at + raw.length;
    const ref = mentionRef(item);
    if (!seen.has(ref)) {
      seen.add(ref);
      items.push(item);
    }
  }

  if (items.length === 0) return { text, items: [] };
  return { text: out + text.slice(cursor), items };
}

/** How long one fetched block may be before it is cut short. */
export const MAX_MENTION_BODY = 12_000;

export function clipMentionBody(body: string, max = MAX_MENTION_BODY): string {
  const text = body.trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}\n…truncated…`;
}

/** Bot comments carry HTML-comment control blocks that say nothing to a reader. */
export function stripHtmlComments(body: string): string {
  return body.replace(/<!--[\s\S]*?-->/g, '').trim();
}

/** How long one comment in a thread may be before it is cut short. */
export const MAX_COMMENT_BODY = 2_000;

/**
 * One comment, trimmed. A thread has many of these and only the whole thread
 * has to fit `clipMentionBody`, so a single ranting comment is cut here rather
 * than being allowed to push every later one out of the block.
 */
export function clipComment(body: string, max = MAX_COMMENT_BODY): string {
  const text = stripHtmlComments(body);
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}\n…`;
}

/* ------------------------------------------------------------------ *
 * Attached context.
 *
 * A picked ticket or PR puts one link in the composer and nothing else. Its
 * description — and its comments or CI checks, when they are asked for — are
 * held beside the box and folded into the prompt on send. Each arrives in a
 * block fenced by a marker line naming the item and what was fetched, so the
 * transcript can take the prompt back apart and show the link rather than
 * several hundred lines of ticket.
 * ------------------------------------------------------------------ */

const EXTRA_NAMES = MENTION_EXTRAS.map((extra) => extra.id).join('|');
const FENCE = new RegExp(`^--- (?:end )?\\S.* (?:${EXTRA_NAMES}) ---$`);

function openLine(id: string, extra: MentionExtra): string {
  return `--- ${id} ${extra} ---`;
}

function closeLine(id: string, extra: MentionExtra): string {
  return `--- end ${id} ${extra} ---`;
}

/** A fetched body cannot smuggle in a marker line and split its own block. */
function stripFences(body: string): string {
  return body
    .split('\n')
    .filter((line) => !FENCE.test(line.trim()))
    .join('\n');
}

export function mentionBlock(item: MentionItem, extra: MentionExtra, body: string): string {
  const text = clipMentionBody(stripFences(body)) || '(nothing to show)';
  return `${openLine(item.id, extra)}\n${text}\n${closeLine(item.id, extra)}`;
}

/** One fetched block, held next to the composer rather than inside it. */
export interface MentionAttachment {
  item: MentionItem;
  extra: MentionExtra;
  body: string;
}

/**
 * How one fetched block is addressed: which item, and which part of it. The
 * composer, the chips and the send all key off this, so they cannot disagree
 * about whether a block is already here.
 */
export function extraKey(item: MentionItem, extra: MentionExtra): string {
  return `${mentionRef(item)}:${extra}`;
}

/**
 * Swap one occurrence of a link for a longer or shorter version of itself,
 * keeping the caret where the typing left it.
 *
 * A pasted ticket is looked up a second or two after it lands, by which time
 * the user has usually typed on. Null means there is nothing to do — the link
 * is gone, or the lookup found the same text that was already there.
 */
export function swapMentionLink(
  text: string,
  caret: number,
  before: string,
  after: string
): { text: string; cursor: number } | null {
  if (before === after) return null;
  const at = text.indexOf(before);
  if (at < 0) return null;
  const delta = after.length - before.length;
  return {
    text: `${text.slice(0, at)}${after}${text.slice(at + before.length)}`,
    cursor: caret > at ? caret + delta : caret
  };
}

/**
 * The prompt as it goes to the agent: what was typed, then every block that
 * was fetched for the tickets and PRs still linked in it. This runs on send,
 * which is why the textarea never has to hold any of it.
 */
export function composeMentionPrompt(text: string, attachments: MentionAttachment[]): string {
  const typed = text.trim();
  const blocks = attachments
    .filter((attachment) => attachment.body.trim())
    .map((attachment) => mentionBlock(attachment.item, attachment.extra, attachment.body));
  return [typed, ...blocks].filter(Boolean).join('\n\n');
}

export type PromptSegment =
  | { kind: 'text'; text: string }
  | { kind: 'block'; id: string; extra: MentionExtra; body: string };

const BLOCK_PATTERN = new RegExp(
  `(?:^|\\n)--- (\\S+) (${EXTRA_NAMES}) ---\\n([\\s\\S]*?)\\n--- end \\1 \\2 ---(?=\\n|$)`,
  'g'
);

/**
 * Take a sent prompt back apart into what the person wrote and the blocks that
 * were attached to it. The transcript stores the whole thing; this is what
 * lets the session view show the sentence and leave the ticket folded up.
 */
export function splitMentionBlocks(text: string): PromptSegment[] {
  const segments: PromptSegment[] = [];
  const pattern = new RegExp(BLOCK_PATTERN.source, 'g');
  let cursor = 0;
  let match: RegExpExecArray | null;

  const pushText = (raw: string) => {
    const trimmed = raw.replace(/^\n+/, '').replace(/\s+$/, '');
    if (trimmed) segments.push({ kind: 'text', text: trimmed });
  };

  while ((match = pattern.exec(text)) !== null) {
    pushText(text.slice(cursor, match.index));
    segments.push({
      kind: 'block',
      id: match[1]!,
      extra: match[2] as MentionExtra,
      body: match[3]!
    });
    cursor = pattern.lastIndex;
  }
  pushText(text.slice(cursor));
  return segments;
}

/**
 * Is the item still referenced? The url is the anchor rather than the whole
 * link, so editing the link text does not orphan the item's controls.
 */
export function mentionInText(text: string, item: MentionItem): boolean {
  return !!item.url && text.includes(item.url);
}

/* ------------------------------------------------------------------ *
 * Menu list handling.
 * ------------------------------------------------------------------ */

export function filterMentions(items: MentionItem[], query: string): MentionItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => {
    const hay = `${item.id} ${item.title} ${item.subtitle || ''} ${item.status || ''}`.toLowerCase();
    return hay.includes(needle) || item.id.toLowerCase().replace(/[-/#]/g, '').includes(needle.replace(/[-/#]/g, ''));
  });
}

/**
 * Keep both Jira and GitHub visible when the list is longer than the menu.
 * Jira stays first; leftover slots go to whichever kind still has items.
 */
export function capMentions(items: MentionItem[], limit = 25): MentionItem[] {
  const jira = items.filter((item) => item.kind === 'jira');
  const github = items.filter((item) => item.kind !== 'jira');
  if (jira.length + github.length <= limit) return [...jira, ...github];
  const githubTake = Math.min(github.length, Math.max(Math.ceil(limit / 2), limit - jira.length));
  const jiraTake = Math.min(jira.length, limit - githubTake);
  return [...jira.slice(0, jiraTake), ...github.slice(0, githubTake)];
}

/**
 * A Jira key as Jira spells it: `WEB-1234`. Anything else is refused before it
 * reaches `acli`'s command line, where it could be read as a flag.
 */
export function isJiraKey(id: string): boolean {
  return /^[A-Z][A-Z0-9_]+-\d+$/.test(id);
}

/**
 * `https://github.com/owner/repo/pull/9404` → `owner/repo` and `9404`.
 *
 * The repo ends up on `gh`'s command line, so it has to be a github.com URL
 * and only the characters GitHub allows in owner and repo names.
 */
export function parsePullRequestUrl(url: string): { repo: string; number: number } | null {
  const match = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+)\/pull\/(\d+)(?:[/?#]|$)/i.exec(
    (url || '').trim()
  );
  if (!match) return null;
  return { repo: match[1]!, number: Number(match[2]) };
}

/**
 * `https://github.com/owner/repo/actions/runs/123/job/456` → the repo, the run
 * and, when the link was to one job, the job. Same character rules as
 * `parsePullRequestUrl`, for the same reason: all of it goes on `gh`'s
 * command line.
 */
export function parseRunUrl(url: string): { repo: string; runId: number; jobId?: number } | null {
  const match = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+)\/actions\/runs\/(\d+)(?:\/(?:job|jobs|attempts\/\d+\/job)\/(\d+))?(?:[/?#]|$)/i.exec(
    (url || '').trim()
  );
  if (!match) return null;
  return { repo: match[1]!, runId: Number(match[2]), ...(match[3] ? { jobId: Number(match[3]) } : {}) };
}
