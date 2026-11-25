/**
 * Pure rules for forking a session from any conversation point and keeping
 * routine lifecycle chatter out of the transcript.
 *
 * Shared by the transcript UI (anchoring a fork to a message) and the OpenCode
 * DB cloner (slicing V1 or V2 history cleanly up to that message).
 */

import { TaskLogItem } from '../types.js';

export type ForkMode = 'after' | 'before';

/** A chosen point in a session's transcript where a new branch should start. */
export interface ForkAnchor {
  /** OpenCode message id to cut at (inclusive when `after`, exclusive when `before`). */
  messageId: string;
  /** Transcript log id highlighted on screen. */
  logId: string;
  /** 1-based conversation turn number among user & agent turns. */
  turnNumber: number;
  role: 'user' | 'agent';
  mode: ForkMode;
  /** Short human label stored on the forked link, e.g. `turn #3`. */
  label: string;
  /** Single-line preview of the anchored turn for the composer banner. */
  preview: string;
  /** Full text of a user turn, used to pre-fill the composer on "Fork & edit". */
  originalText?: string;
}

/**
 * Routine lifecycle info lines add vertical noise without telling the user
 * anything the idle composer and finished answer do not already say.
 */
const ROUTINE_INFO_MESSAGES = new Set([
  'Agent finished this turn.'
]);

export function isNoiseLog(log: Pick<TaskLogItem, 'type' | 'text'>): boolean {
  if (log.type !== 'info') return false;
  return ROUTINE_INFO_MESSAGES.has((log.text || '').trim());
}

/**
 * Extract the OpenCode message id for a transcript log entry.
 *
 * `history.ts` stamps `log.messageId` directly; V2 part ids also carry the
 * message id before `:` (`msg_abc:text`, `msg_abc:00001`).
 */
export function forkableMessageId(log: Pick<TaskLogItem, 'id' | 'messageId'>): string | undefined {
  if (log.messageId) return log.messageId;
  const colon = log.id.indexOf(':');
  if (colon > 0) {
    const prefix = log.id.slice(0, colon);
    if (prefix.startsWith('msg_') || prefix.startsWith('msg-')) return prefix;
  }
  return undefined;
}

function previewLine(text: string, max = 72): string {
  const first = (text || '').replace(/\s+/g, ' ').trim();
  if (!first) return '(empty)';
  return first.length > max ? `${first.slice(0, max).trimEnd()}…` : first;
}

/**
 * Build the anchor for a conversation turn in `logs`.
 * Returns undefined when the entry is not a user/agent turn or has no message id
 * in OpenCode's database yet (for example, a still-streaming local echo).
 */
export function buildForkAnchor(
  log: TaskLogItem,
  logs: readonly TaskLogItem[],
  mode: ForkMode
): ForkAnchor | undefined {
  if (log.type !== 'user_say' && log.type !== 'agent_say') return undefined;
  const messageId = forkableMessageId(log);
  if (!messageId) return undefined;

  let turnNumber = 0;
  for (const entry of logs) {
    if (entry.type === 'user_say' || entry.type === 'agent_say') turnNumber++;
    if (entry.id === log.id) break;
  }
  if (turnNumber === 0) turnNumber = 1;

  const role = log.type === 'user_say' ? 'user' : 'agent';
  return {
    messageId,
    logId: log.id,
    turnNumber,
    role,
    mode,
    label: `turn #${turnNumber}`,
    preview: previewLine(log.text),
    originalText: role === 'user' ? log.text : undefined
  };
}

/**
 * Slice OpenCode 1.x `message` rows up to `upToMessageId`.
 * Returns `null` if the anchor message does not exist in `messages` so callers
 * fail safely instead of silently cloning the entire session.
 */
export function sliceMessagesForFork<T extends { id: string }>(
  messages: readonly T[],
  upToMessageId: string,
  exclusive = false
): T[] | null {
  const index = messages.findIndex((message) => message.id === upToMessageId);
  if (index < 0) return null;
  return messages.slice(0, exclusive ? index : index + 1);
}

/**
 * Slice OpenCode 2.x `session_message` rows up to `upToMessageId` by `seq`.
 * Preserves bookkeeping rows (`system`, `model-switched`, `agent-switched`)
 * that occurred before or at the cut point, and returns the sequence watermark
 * to seed `event_sequence` with.
 */
export function sliceV2MessagesForFork<T extends { id: string; seq: number }>(
  messages: readonly T[],
  upToMessageId: string,
  exclusive = false
): { items: T[]; lastSeq: number } | null {
  const target = messages.find((message) => message.id === upToMessageId);
  if (!target) return null;
  const targetSeq = Number(target.seq) || 0;
  const items = messages.filter((message) => {
    const seq = Number(message.seq) || 0;
    return exclusive ? seq < targetSeq : seq <= targetSeq;
  });
  let lastSeq = 0;
  for (const item of items) {
    lastSeq = Math.max(lastSeq, Number(item.seq) || 0);
  }
  return { items, lastSeq };
}
