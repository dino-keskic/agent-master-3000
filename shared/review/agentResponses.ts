/**
 * The agent's answers to changelog comments, as the MCP tool receives them:
 * reply, resolve, reopen — read out of whatever shape the call arrived in.
 */

import { clipCommentBody } from './changelogComments.js';

export type ChangelogStatus = 'resolved' | 'open';

/** One comment's worth of agent response: say something, close it, or both. */
export interface ChangelogResponse {
  commentId: string;
  reply?: string;
  /** Omitted leaves the thread's open/resolved state alone. */
  status?: ChangelogStatus;
}

export interface ChangelogResponseOutcome {
  commentId: string;
  replied: boolean;
  status?: ChangelogStatus;
}

export interface ChangelogResponseResult {
  applied: ChangelogResponseOutcome[];
  /** Ids that matched no comment on the task. */
  missing: string[];
}

function readStatus(value: unknown): ChangelogStatus | undefined {
  if (value === 'resolved' || value === true) return 'resolved';
  if (value === 'open' || value === 'reopen' || value === false) return 'open';
  return undefined;
}

/**
 * Read the loose shapes a tool call arrives in — a list of responses, or the
 * single `commentId` an agent reaches for out of habit — into one list. Entries
 * without an id, and ones that neither reply nor change status, are dropped so
 * a malformed call cannot look like it did something.
 */
export function normalizeChangelogResponses(input: unknown): ChangelogResponse[] {
  const raw: unknown[] = Array.isArray(input)
    ? input
    : input && typeof input === 'object'
      ? [input]
      : [];
  const byId = new Map<string, ChangelogResponse>();
  for (const entry of raw) {
    if (typeof entry === 'string') {
      const id = entry.trim();
      if (id) byId.set(id, { commentId: id, status: 'resolved', ...byId.get(id) });
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const commentId = typeof item.commentId === 'string' ? item.commentId.trim() : '';
    if (!commentId) continue;
    const body = typeof item.reply === 'string' ? item.reply : typeof item.body === 'string' ? item.body : '';
    const reply = clipCommentBody(body);
    const status = readStatus(item.status ?? item.resolve ?? item.resolved);
    if (!reply && !status) continue;
    const previous = byId.get(commentId);
    byId.set(commentId, {
      commentId,
      reply: reply || previous?.reply,
      status: status || previous?.status
    });
  }
  return [...byId.values()];
}
