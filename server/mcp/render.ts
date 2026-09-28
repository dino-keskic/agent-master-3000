import { ChangelogResponseResult } from '../../shared/review/agentResponses.js';
import { formatTaskLink, sortTaskLinks } from '../../shared/task/links.js';
import { TaskLink } from '../../shared/types.js';

/**
 * Turning board state into the plain text a tool call returns.
 *
 * Everything here is read by a model, not a person: it is dense on purpose,
 * and every render says what to do next — an agent handed a list of comments
 * with no instruction to answer them tends not to.
 */

export interface SaveLinksResult {
  added?: TaskLink[];
  updated?: TaskLink[];
  rejected?: string[];
  links?: TaskLink[];
}

/** The comments hanging off a task, whatever else the board sent back. */
export function commentsFromTask(task: unknown): unknown[] {
  if (!task || typeof task !== 'object') return [];
  const comments = (task as { changelogComments?: unknown }).changelogComments;
  return Array.isArray(comments) ? comments : [];
}

/** A comment as the agent reads it: id, where it is, and the thread so far. */
export function renderComment(raw: unknown): string {
  const comment = raw as {
    id?: string;
    path?: string;
    newLine?: number;
    oldLine?: number;
    side?: string;
    snippet?: string;
    body?: string;
    author?: string;
    resolvedAt?: number;
    replies?: { author?: string; body?: string }[];
  };
  const line = comment.newLine ?? comment.oldLine;
  const where = comment.side === 'file' || line == null ? `${comment.path} (whole file)` : `${comment.path}:${line}`;
  const lines = [`[${comment.id}] ${where}${comment.resolvedAt ? ' · resolved' : ''}`];
  const snippet = (comment.snippet || '').trim();
  if (snippet) lines.push(`    ${snippet}`);
  lines.push(`  ${comment.author === 'agent' ? 'Agent' : 'User'}: ${comment.body || ''}`);
  for (const reply of comment.replies || []) {
    lines.push(`  ${reply.author === 'agent' ? 'Agent' : 'User'}: ${reply.body || ''}`);
  }
  return lines.join('\n');
}

export function renderList(comments: unknown[], status: string): string {
  if (comments.length === 0) return `No ${status === 'all' ? '' : `${status} `}changelog comments on this task.`;
  const label = `${comments.length} ${status === 'all' ? '' : `${status} `}changelog comment${comments.length === 1 ? '' : 's'}`;
  return [
    `${label}. Handle them all, then call respond_to_changelog_comments once with one entry per comment.`,
    '',
    ...comments.map(renderComment)
  ].join('\n\n');
}

export function renderOutcome(result: ChangelogResponseResult): string {
  const lines = result.applied.map((item) => {
    const parts = [item.replied ? 'replied' : null, item.status === 'resolved' ? 'resolved' : item.status === 'open' ? 'reopened' : null]
      .filter(Boolean)
      .join(' and ');
    return `${item.commentId}: ${parts || 'no change'}`;
  });
  if (result.missing.length > 0) {
    lines.push(`Not found (already deleted?): ${result.missing.join(', ')}`);
  }
  return lines.join('\n') || 'Nothing to apply.';
}

export function renderLinks(links: TaskLink[] | undefined): string {
  const list = sortTaskLinks(links);
  if (list.length === 0) {
    return 'No links on this task yet. Call save_task_links when you find or open the ticket, PR or doc it is about.';
  }
  return [`${list.length} link${list.length === 1 ? '' : 's'} on this task.`, '', ...list.map(formatTaskLink)].join('\n\n');
}

/** The shapes a save arrives in: a list, one object, or a bare URL string. */
export function normalizeLinkInput(raw: unknown): { url: string; title?: string; note?: string }[] {
  const entries: unknown[] = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
  const out: { url: string; title?: string; note?: string }[] = [];
  for (const entry of entries) {
    if (typeof entry === 'string') {
      if (entry.trim()) out.push({ url: entry.trim() });
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const url = typeof item.url === 'string' ? item.url : typeof item.link === 'string' ? item.link : '';
    if (!url.trim()) continue;
    out.push({
      url: url.trim(),
      title: typeof item.title === 'string' ? item.title : undefined,
      note: typeof item.note === 'string' ? item.note : undefined
    });
  }
  return out;
}

export function renderSaveOutcome(result: SaveLinksResult): string {
  const lines: string[] = [];
  for (const link of result.added || []) lines.push(`added ${link.ref || link.url} [${link.id}]`);
  for (const link of result.updated || []) lines.push(`updated ${link.ref || link.url} [${link.id}]`);
  if (result.rejected?.length) lines.push(`Not a usable http(s) URL: ${result.rejected.join(', ')}`);
  return lines.join('\n') || 'Nothing changed — those links were already on the task.';
}

export interface MoveTargets {
  current?: { cwd?: string; projectName?: string };
  sessions?: { sessionId: string; title?: string; cwd?: string; projectName?: string; primary?: boolean; running?: boolean }[];
  projects?: { id: string; name: string; path: string; checkouts?: { path: string; branch?: string }[] }[];
}

/** Every place the work could run, and where it runs now. */
export function renderWorkspaces(data: MoveTargets): string {
  const lines: string[] = [];
  const current = data.current;
  lines.push(`This task runs in ${current?.cwd || 'an unknown folder'}${current?.projectName ? ` (project ${current.projectName})` : ' (no project)'}.`);

  const sessions = data.sessions || [];
  if (sessions.length) {
    lines.push('', 'Sessions:');
    for (const session of sessions) {
      const tags = [session.primary ? 'main' : '', session.running ? 'running' : ''].filter(Boolean);
      lines.push(`- ${session.sessionId}${tags.length ? ` [${tags.join(', ')}]` : ''} — ${session.title || 'untitled'} — ${session.cwd || 'unknown folder'}`);
    }
  }

  const projects = data.projects || [];
  if (!projects.length) {
    lines.push('', 'The board has no project folders, so there is nowhere to move to.');
    return lines.join('\n');
  }

  lines.push('', 'Projects and their checkouts:');
  for (const project of projects) {
    lines.push(`- ${project.name} (projectId ${project.id}) — ${project.path}`);
    for (const checkout of project.checkouts || []) {
      lines.push(`    ${checkout.path}${checkout.branch ? ` [${checkout.branch}]` : ''}`);
    }
  }
  lines.push('', 'Move a session with move_session, passing a projectId, a checkout path as cwd, or both.');
  return lines.join('\n');
}

/** What a move did, in the board\'s own words. */
export function renderMove(result: unknown): string {
  const move = (result as { move?: { log?: string } } | null)?.move;
  return move?.log
    ? `${move.log} Nothing else changed — the turn you are in keeps the folder it started in.`
    : 'Nothing to move: the session is already where you asked for it.';
}
