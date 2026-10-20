import { toolKind } from './toolCall.js';

/**
 * OpenCode 2's background service, said in ACP.
 *
 * The service speaks its own HTTP API: one global `/api/event` stream of
 * `session.*` events, and a message list per session. Everything above the
 * transport — the transcript, the approval desk, the turn runner — already
 * understands ACP's `session/update` and `session/request_permission`, so this
 * turns the one into the other, and does nothing else.
 *
 * Two inputs, one output:
 * - `translateV2Event`: a live event, as it arrives.
 * - `snapshotUpdates`: a session's message list, for a board that re-attaches
 *   to a turn already running — what the live events would have said so far.
 *   `historyUpdates` is the same for the whole session, prompts included.
 *
 * Both name each piece of text by its message and position (`textLogId`), so
 * the snapshot and the live events that follow it land on the same log rows
 * instead of side by side. `session.text.ended` carries the whole of a part:
 * it *replaces* the row, which is what heals the deltas a re-attach missed.
 */

/** One frame of `/api/event`. */
export interface V2Event {
  type: string;
  data?: Record<string, unknown>;
}

/** How a turn ended, in `session/prompt`'s words. */
export type V2StopReason = 'end_turn' | 'cancelled' | 'refusal';

export interface V2PermissionParams {
  sessionId: string;
  title: string;
  toolCall: { toolCallId: string; title: string; kind: string; status: 'pending' };
  options: { optionId: V2PermissionDecision; name: string; kind: 'allow_once' | 'allow_always' | 'reject_once' }[];
}

/** What `POST /api/session/{id}/permission/{per}/reply` takes. */
export type V2PermissionDecision = 'once' | 'always' | 'reject';

export type V2Output =
  /** A `session/update` notification's params. */
  | { kind: 'update'; sessionId: string; update: Record<string, unknown> }
  /** A `session/request_permission` request; answered by `requestId`. */
  | { kind: 'permission'; sessionId: string; requestId: string; params: V2PermissionParams }
  /** A permission was answered — maybe by someone else, in the TUI. */
  | { kind: 'permission_settled'; sessionId: string; requestId: string }
  | { kind: 'turn_started'; sessionId: string }
  | { kind: 'turn_ended'; sessionId: string; stopReason: V2StopReason; error?: string };

/** The options the board offers on a v2 permission, mapped straight onto its replies. */
export const V2_PERMISSION_OPTIONS: V2PermissionParams['options'] = [
  { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
  { optionId: 'always', name: 'Always allow', kind: 'allow_always' },
  { optionId: 'reject', name: 'Reject', kind: 'reject_once' }
];

/** The log row of a message's `ordinal`th text part. */
export function textLogId(messageId: string, ordinal: number): string {
  return `v2:${messageId}:text:${ordinal}`;
}

/** The log row of a message's `ordinal`th reasoning part. */
export function reasoningLogId(messageId: string, ordinal: number): string {
  return `v2:${messageId}:reasoning:${ordinal}`;
}

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

/** A tool's input as it streams in is JSON text, and may not parse yet. */
function inputRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string') return record(value);
  try {
    return record(JSON.parse(value));
  } catch {
    return undefined;
  }
}

/** A tool result's text blocks, as ACP content. */
function toolContent(content: unknown): { type: 'content'; content: { type: 'text'; text: string } }[] | undefined {
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((block) => record(block))
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block!.text as string)
    .join('');
  return text ? [{ type: 'content', content: { type: 'text', text } }] : undefined;
}

function chunk(kind: 'agent_message_chunk' | 'agent_thought_chunk', messageId: string, logId: string, text: string, replace: boolean) {
  return {
    sessionUpdate: kind,
    messageId,
    content: { type: 'text', text },
    _meta: { logId, ...(replace ? { replace: true } : {}) }
  };
}

function toolUpdate(id: string, fields: Record<string, unknown>): Record<string, unknown> {
  return { sessionUpdate: 'tool_call_update', toolCallId: id, ...fields };
}

/** A text or reasoning event: `session.text.delta` and its kin. */
function partEvent(type: string, data: Record<string, unknown>): Record<string, unknown> | null {
  const match = /^session\.(text|reasoning)\.(delta|ended)$/.exec(type);
  const messageId = str(data.assistantMessageID);
  if (!match || !messageId) return null;
  const isText = match[1] === 'text';
  const ordinal = num(data.ordinal);
  const ended = match[2] === 'ended';
  const text = str(ended ? data.text : data.delta);
  if (text === undefined) return null;
  return chunk(
    isText ? 'agent_message_chunk' : 'agent_thought_chunk',
    messageId,
    isText ? textLogId(messageId, ordinal) : reasoningLogId(messageId, ordinal),
    text,
    ended
  );
}

function toolEvent(type: string, data: Record<string, unknown>): Record<string, unknown> | null {
  const id = str(data.id);
  if (!id) return null;
  switch (type) {
    case 'session.tool.input.started': {
      const name = str(data.name) ?? 'tool';
      return { sessionUpdate: 'tool_call', toolCallId: id, title: name, kind: toolKind(name), status: 'pending' };
    }
    case 'session.tool.input.ended': {
      const rawInput = inputRecord(data.text);
      return rawInput ? toolUpdate(id, { rawInput }) : null;
    }
    case 'session.tool.called':
      return toolUpdate(id, { status: 'in_progress', ...(record(data.input) ? { rawInput: data.input } : {}) });
    case 'session.tool.success':
      return toolUpdate(id, {
        status: 'completed',
        content: toolContent(data.content),
        rawOutput: { metadata: data.metadata }
      });
    case 'session.tool.error':
    case 'session.tool.failed': {
      const error = str(data.error) ?? str(record(data.error)?.message);
      return toolUpdate(id, {
        status: 'failed',
        content: toolContent(data.content) ?? (error ? [{ type: 'content', content: { type: 'text', text: error } }] : undefined)
      });
    }
    default:
      return null;
  }
}

/** A permission the service is waiting on, as the approval desk takes it. */
function permissionParams(sessionId: string, requestId: string, data: Record<string, unknown>): V2PermissionParams {
  const action = str(data.action) ?? 'permission';
  const resources = Array.isArray(data.resources) ? data.resources.filter((r): r is string => typeof r === 'string') : [];
  const source = record(data.source);
  return {
    sessionId,
    title: resources.length ? `${action}: ${resources.join(', ')}` : action,
    toolCall: { toolCallId: str(source?.id) ?? requestId, title: action, kind: toolKind(action), status: 'pending' },
    options: V2_PERMISSION_OPTIONS
  };
}

/** How `session.execution.<outcome>` ended the turn. */
function executionEnd(outcome: string, data: Record<string, unknown>): { stopReason: V2StopReason; error?: string } {
  if (outcome === 'succeeded') return { stopReason: 'end_turn' };
  if (outcome === 'interrupted' || outcome === 'cancelled' || outcome === 'aborted') return { stopReason: 'cancelled' };
  const error = record(data.error);
  return { stopReason: 'refusal', error: str(error?.message) ?? str(data.error) ?? str(data.message) ?? `The turn ${outcome}` };
}

/** One live event, in ACP terms; none for the bookkeeping the board has no use for. */
export function translateV2Event(event: V2Event): V2Output[] {
  const data = record(event.data) ?? {};
  const sessionId = str(data.sessionID);
  if (!sessionId) return [];
  const { type } = event;

  const part = partEvent(type, data);
  if (part) return [{ kind: 'update', sessionId, update: part }];

  if (type.startsWith('session.tool.')) {
    const update = toolEvent(type, data);
    return update ? [{ kind: 'update', sessionId, update }] : [];
  }

  if (type === 'permission.asked') {
    const requestId = str(data.id);
    return requestId ? [{ kind: 'permission', sessionId, requestId, params: permissionParams(sessionId, requestId, data) }] : [];
  }
  if (type === 'permission.replied') {
    const requestId = str(data.requestID);
    return requestId ? [{ kind: 'permission_settled', sessionId, requestId }] : [];
  }

  if (type === 'session.renamed') {
    const title = str(data.title);
    return title ? [{ kind: 'update', sessionId, update: { sessionUpdate: 'session_info_update', title } }] : [];
  }

  if (type === 'session.execution.started') return [{ kind: 'turn_started', sessionId }];
  const execution = /^session\.execution\.(\w+)$/.exec(type);
  if (execution) return [{ kind: 'turn_ended', sessionId, ...executionEnd(execution[1]!, data) }];

  return [];
}

// --- the snapshot half ---

/** One row of `GET /api/session/{id}/message`. */
export interface V2MessageRow {
  id: string;
  type: string;
  [field: string]: unknown;
}

const SNAPSHOT_STATUS: Record<string, string> = {
  streaming: 'pending',
  running: 'in_progress',
  completed: 'completed',
  error: 'failed'
};

function snapshotTool(entry: Record<string, unknown>): Record<string, unknown> | null {
  const id = str(entry.id);
  if (!id) return null;
  const name = str(entry.name) ?? 'tool';
  const state = record(entry.state) ?? {};
  const status = SNAPSHOT_STATUS[str(state.status) ?? ''] ?? 'pending';
  const error = str(state.error) ?? str(record(state.error)?.message);
  const content = toolContent(state.content) ?? (error ? [{ type: 'content', content: { type: 'text', text: error } }] : undefined);
  const rawInput = inputRecord(state.input);
  return {
    sessionUpdate: 'tool_call',
    toolCallId: id,
    title: name,
    kind: toolKind(name),
    status,
    ...(rawInput ? { rawInput } : {}),
    ...(content ? { content } : {}),
    ...(state.metadata !== undefined ? { rawOutput: { metadata: state.metadata } } : {})
  };
}

/** One assistant message's parts, in the order they were written. */
function assistantUpdates(row: V2MessageRow): Record<string, unknown>[] {
  const content = Array.isArray(row.content) ? row.content : [];
  const updates: Record<string, unknown>[] = [];
  let texts = 0;
  let thoughts = 0;
  for (const raw of content) {
    const entry = record(raw);
    if (!entry) continue;
    if (entry.type === 'text') {
      const ordinal = texts++;
      // A part still streaming is stored empty until it ends; the live
      // deltas and `text.ended` fill it in.
      const text = str(entry.text);
      if (text) updates.push(chunk('agent_message_chunk', row.id, textLogId(row.id, ordinal), text, true));
    } else if (entry.type === 'reasoning') {
      const ordinal = thoughts++;
      const text = str(entry.text);
      if (text) updates.push(chunk('agent_thought_chunk', row.id, reasoningLogId(row.id, ordinal), text, true));
    } else if (entry.type === 'tool') {
      const update = snapshotTool(entry);
      if (update) updates.push(update);
    }
  }
  return updates;
}

/**
 * The turn in progress, as the updates the live stream would have sent: every
 * assistant message after the last prompt. Earlier turns are history, which
 * the board reads from the database like any other.
 */
export function snapshotUpdates(rows: readonly V2MessageRow[]): Record<string, unknown>[] {
  let start = 0;
  rows.forEach((row, index) => {
    if (row.type === 'user') start = index + 1;
  });
  return rows.slice(start).filter((row) => row.type === 'assistant').flatMap(assistantUpdates);
}

/**
 * A whole session, as `session/load` replays one over ACP: each prompt, then
 * what answered it. For a task that resumes a session with no log of its own.
 */
export function historyUpdates(rows: readonly V2MessageRow[]): Record<string, unknown>[] {
  return rows.flatMap((row) => {
    if (row.type === 'assistant') return assistantUpdates(row);
    if (row.type !== 'user') return [];
    const text = str(row.text);
    return text
      ? [{ sessionUpdate: 'user_message_chunk', messageId: row.id, content: { type: 'text', text }, _meta: { logId: `v2:${row.id}:user`, replace: true } }]
      : [];
  });
}

/**
 * Whether a session's last message row says its turn is over.
 *
 * An `idle` row is written when a turn ends however it ends. A step closed
 * as `aborted` with nothing after it is a turn somebody stopped — or one whose
 * service died, which the service resumes on its own by appending a
 * `synthetic` restart notice; until then, it is not running.
 */
export function v2RowEndsTurn(type: string | null | undefined, data: unknown): boolean {
  if (type === 'idle') return true;
  if (type !== 'assistant') return false;
  return record(record(data)?.error)?.type === 'aborted';
}
