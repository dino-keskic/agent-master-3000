import { MentionItem, clipComment, parsePullRequestUrl, stripHtmlComments } from '../../shared/trackers/mentions.js';
import { NormalizedStatus, normalizePrStatus } from '../../shared/trackers/linkStatus.js';
import { runJson } from './cli.js';
import { errorField } from '../../shared/errors.js';

/**
 * Everything that knows the shape of `gh` output.
 *
 * Only pull requests, not issues: a PR is what a task is usually about, and
 * `parsePullRequestUrl` is what decides whether a pasted link is one.
 */

interface GhPr {
  number?: number;
  title?: string;
  url?: string;
  repository?: { name?: string; nameWithOwner?: string };
}

export async function searchGithub(query: string): Promise<MentionItem[]> {
  const args = [
    'search',
    'prs',
    '--involves=@me',
    '--state=open',
    '--limit',
    '20',
    '--json',
    'number,title,url,repository'
  ];
  const q = query.trim();
  // `--` so a query that starts with a dash is searched for, not parsed as a
  // flag (`--web`, `--repo=…`).
  if (q) args.push('--', q);
  const raw = await runJson('gh', args);
  const rows = Array.isArray(raw) ? (raw as GhPr[]) : [];
  return rows.flatMap((pr) => {
    const number = Number(pr.number);
    const repo = pr.repository?.nameWithOwner || pr.repository?.name;
    if (!number || !repo) return [];
    const short = repo.split('/')[1] || repo;
    return [{
      kind: 'github' as const,
      id: `${short}#${number}`,
      title: pr.title?.trim() || `PR #${number}`,
      url: pr.url || `https://github.com/${repo}/pull/${number}`,
      status: 'Open',
      subtitle: repo
    }];
  });
}

function pullRequest(item: MentionItem): { repo: string; number: number } {
  const ref = parsePullRequestUrl(item.url);
  if (!ref) throw new Error(`Not a pull request URL: ${item.url}`);
  return ref;
}

export async function githubDescription(item: MentionItem): Promise<string> {
  const ref = pullRequest(item);
  const raw = await runJson('gh', [
    'pr', 'view', String(ref.number), `--repo=${ref.repo}`, '--json', 'title,body,state,isDraft,headRefName,baseRefName'
  ]);
  const pr = (raw || {}) as {
    title?: string; body?: string; state?: string; isDraft?: boolean;
    headRefName?: string; baseRefName?: string;
  };
  const head = [
    pr.title?.trim(),
    [pr.isDraft ? 'Draft' : pr.state, pr.headRefName && `${pr.headRefName} → ${pr.baseRefName}`]
      .filter(Boolean)
      .join(' · ')
  ]
    .filter(Boolean)
    .join('\n');
  const body = stripHtmlComments(pr.body || '');
  return [head, body || '(no description)'].filter(Boolean).join('\n\n');
}

interface GhComment {
  author?: { login?: string };
  body?: string;
  createdAt?: string;
  state?: string;
}

function ghLine(row: GhComment, suffix?: string): string {
  const who = row.author?.login?.trim() || 'unknown';
  const when = row.createdAt ? row.createdAt.slice(0, 10) : '';
  const meta = [suffix, when].filter(Boolean).join(' · ');
  return `**@${who}**${meta ? ` — ${meta}` : ''}\n${clipComment(row.body || '')}`.trim();
}

export async function githubComments(item: MentionItem): Promise<string> {
  const ref = pullRequest(item);
  const raw = await runJson('gh', [
    'pr', 'view', String(ref.number), `--repo=${ref.repo}`, '--json', 'comments,reviews'
  ]);
  const data = (raw || {}) as { comments?: GhComment[]; reviews?: GhComment[] };
  const reviews = (data.reviews || []).filter((row) => row.body?.trim() || row.state);
  const parts = [
    ...reviews.map((row) => ghLine(row, row.state)),
    ...(data.comments || []).map((row) => ghLine(row))
  ].filter((part) => part.trim());
  return parts.length === 0 ? 'No comments or reviews.' : parts.join('\n\n');
}

interface GhCheck {
  name?: string;
  workflow?: string;
  state?: string;
  bucket?: string;
  link?: string;
  description?: string;
}

const BUCKET_ORDER = ['fail', 'pending', 'cancel', 'skipping', 'pass'];

/**
 * Failures and anything still running are listed in full — they are the reason
 * anyone asks. Green checks collapse to a count, because a hundred passing
 * rows is the part of `gh pr checks` nobody needed in a prompt.
 */
export async function githubChecks(item: MentionItem): Promise<string> {
  const ref = pullRequest(item);
  const raw = await runJson('gh', [
    'pr', 'checks', String(ref.number), `--repo=${ref.repo}`, '--json', 'name,workflow,state,bucket,link,description'
  ]).catch((e: unknown) => {
    // `gh pr checks` exits non-zero when anything is failing or pending, and
    // still prints the rows we want on stdout.
    const stdout = errorField(e, 'stdout')?.trim();
    if (!stdout) throw e;
    return JSON.parse(stdout) as unknown;
  });
  const rows = (Array.isArray(raw) ? raw : []) as GhCheck[];
  if (rows.length === 0) return 'No checks have reported.';

  const counts = new Map<string, number>();
  for (const row of rows) {
    const bucket = row.bucket || 'unknown';
    counts.set(bucket, (counts.get(bucket) || 0) + 1);
  }
  const summary = BUCKET_ORDER.filter((bucket) => counts.has(bucket))
    .map((bucket) => `${counts.get(bucket)} ${bucket}`)
    .join(' · ');

  const notable = rows.filter((row) => row.bucket !== 'pass' && row.bucket !== 'skipping');
  const lines = notable.map((row) => {
    const where = row.workflow ? ` (${row.workflow})` : '';
    const why = row.description?.trim() ? ` — ${row.description.trim()}` : '';
    return `- ${row.state || row.bucket}: ${row.name || 'check'}${where}${why}${row.link ? `\n  ${row.link}` : ''}`;
  });
  const green = (counts.get('pass') || 0) + (counts.get('skipping') || 0);
  if (lines.length === 0) return `${summary}\nEverything that reported is green.`;
  return [summary, ...lines, green > 0 ? `\n${green} other checks passed or were skipped.` : '']
    .filter(Boolean)
    .join('\n');
}

/** The state a linked PR is in, for the card. Null when `gh` has no such PR. */
export async function pullRequestStatus(
  repo: string,
  number: number
): Promise<{ title?: string; status: NormalizedStatus } | null> {
  const raw = await runJson('gh', [
    'pr', 'view', String(number), `--repo=${repo}`, '--json', 'title,state,isDraft'
  ]);
  const pr = (raw || {}) as { title?: string; state?: string; isDraft?: boolean };
  const status = normalizePrStatus(pr.state, pr.isDraft);
  if (!status) return null;
  return { title: pr.title?.trim() || undefined, status };
}

/** The one line behind a pasted PR link. */
export async function resolveGithub(item: MentionItem): Promise<MentionItem> {
  const ref = pullRequest(item);
  const raw = await runJson('gh', [
    'pr', 'view', String(ref.number), `--repo=${ref.repo}`, '--json', 'title,state,isDraft'
  ]);
  const pr = (raw || {}) as { title?: string; state?: string; isDraft?: boolean };
  const title = pr.title?.trim();
  if (!title) throw new Error(`No pull request ${ref.repo}#${ref.number}`);
  return {
    ...item,
    title,
    status: pr.isDraft ? 'Draft' : pr.state,
    subtitle: ref.repo
  };
}
