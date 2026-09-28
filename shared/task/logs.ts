import { BoardTask, TaskLogItem, TaskSessionLink, ToolCallInfo } from '../types.js';

/**
 * How much transcript a task keeps. The board is a live view, not an archive —
 * OpenCode's own history holds everything, and the drawer falls back to it.
 *
 * Client and server share the number so a transcript the client folds deltas
 * into stays the same list the server would have produced.
 */
export const MAX_TASK_LOGS = 250;

function capLogs(logs: TaskLogItem[], max: number): TaskLogItem[] {
  return logs.length > max ? logs.slice(logs.length - max) : logs;
}

function sortLogs(logs: TaskLogItem[]): TaskLogItem[] {
  return [...logs].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
}

/** Import clipping adds a `\n…` suffix; strip it so prefix matching still works. */
function comparableText(text: string): string {
  return text.endsWith('\n…') ? text.slice(0, -2) : text;
}

const STATUS_RANK: Record<string, number> = {
  pending: 1,
  in_progress: 2,
  completed: 3,
  failed: 3
};

function combineTool(a?: ToolCallInfo, b?: ToolCallInfo): ToolCallInfo | undefined {
  if (!a) return b;
  if (!b) return a;
  const newer = (STATUS_RANK[b.status] ?? 0) >= (STATUS_RANK[a.status] ?? 0) ? b : a;
  const older = newer === b ? a : b;
  return {
    ...older,
    ...newer,
    rawInput: newer.rawInput && Object.keys(newer.rawInput).length > 0 ? newer.rawInput : older.rawInput,
    output: newer.output || older.output,
    locations: newer.locations && newer.locations.length > 0 ? newer.locations : older.locations
  };
}

function mergeMeta(
  a?: Record<string, unknown>,
  b?: Record<string, unknown>
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = { ...(a || {}) };
  if (b) {
    for (const [key, value] of Object.entries(b)) {
      if (value !== undefined && value !== null && value !== '') out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Same event from two sources (ACP stream vs OpenCode part). Keep the id the
 * live stream already uses so later `TASK_LOG` deltas still replace in place.
 */
function preferText(held: string, incoming: string): string {
  const a = held || '';
  const b = incoming || '';
  if (!a) return b;
  if (!b) return a;
  const ca = comparableText(a);
  const cb = comparableText(b);
  if (ca === cb) return a.length >= b.length ? a : b;
  if (cb.startsWith(ca) || ca.startsWith(cb)) return ca.length >= cb.length ? a : b;
  return b;
}

export function combineLogItems(held: TaskLogItem, incoming: TaskLogItem): TaskLogItem {
  const text = preferText(held.text || '', incoming.text || '');
  return {
    ...held,
    ...incoming,
    id: held.id,
    text,
    title: incoming.title || held.title,
    toolCall: combineTool(held.toolCall, incoming.toolCall),
    metadata: mergeMeta(incoming.metadata, held.metadata),
    timestamp: held.timestamp || incoming.timestamp,
    sessionId: held.sessionId || incoming.sessionId
  };
}

function scoreLogMatch(held: TaskLogItem, incoming: TaskLogItem): number {
  if (held.id === incoming.id) return 100;
  if (held.type !== incoming.type) return 0;
  if (held.sessionId && incoming.sessionId && held.sessionId !== incoming.sessionId) return 0;

  const heldTool = held.toolCall?.toolCallId;
  const incomingTool = incoming.toolCall?.toolCallId;
  if (heldTool && incomingTool && heldTool === incomingTool) return 100;
  if (held.type === 'tool_call') return 0;

  const a = comparableText(held.text || '');
  const b = comparableText(incoming.text || '');
  if (!a || !b) return 0;
  if (a === b) return 90;

  if (a.startsWith(b) || b.startsWith(a)) {
    const shorter = Math.min(a.length, b.length);
    if (shorter < 32) return 0;
    const dt = Math.abs((held.timestamp || 0) - (incoming.timestamp || 0));
    if (dt > 5 * 60 * 1000) return 0;
    return 50 + Math.min(30, Math.floor(shorter / 20));
  }
  return 0;
}

/**
 * Find the held row that is the same event as `incoming`.
 *
 * Streamed ACP entries use UUIDs; OpenCode history uses part ids. Matching
 * only on `id` appends a second copy of every turn, which is what made the
 * drawer flash the last message and then rebuild the transcript.
 */
export function findMatchingLogIndex(
  logs: TaskLogItem[],
  incoming: TaskLogItem,
  skip?: Set<number>
): number {
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < logs.length; i++) {
    if (skip?.has(i)) continue;
    const held = logs[i];
    if (!held) continue;
    if (held.id === incoming.id) return i;
    const score = scoreLogMatch(held, incoming);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return bestScore >= 50 ? best : -1;
}

/**
 * Fold one streamed log into a transcript the way the store does.
 *
 * A tool call streams its updates under a stable `toolCallId`, which is also the
 * log id, so an id already in the list is replaced where it stands. Appending
 * instead would grow one copy of the call per streamed chunk, and would move it
 * out of the order the conversation actually happened in.
 */
export function appendLog(logs: TaskLogItem[], log: TaskLogItem, max = MAX_TASK_LOGS): TaskLogItem[] {
  const byId = logs.findIndex((entry) => entry.id === log.id);
  if (byId >= 0) {
    const next = [...logs];
    next[byId] = { ...logs[byId], ...log, timestamp: log.timestamp || Date.now() };
    return next;
  }
  const byContent = findMatchingLogIndex(logs, log);
  if (byContent >= 0) {
    const next = [...logs];
    next[byContent] = combineLogItems(logs[byContent]!, log);
    return next;
  }
  return capLogs([...logs, log], max);
}

/** The same fold, on the task the client holds. */
export function appendTaskLog(task: BoardTask, log: TaskLogItem, max = MAX_TASK_LOGS): BoardTask {
  return { ...task, logs: appendLog(task.logs, log, max) };
}

const LIVE_TOOL: ReadonlySet<string> = new Set(['pending', 'in_progress']);

/**
 * Mark in-flight tools as failed. Stop ends the turn; leftover `in_progress`
 * rows would otherwise look live the next time the session is busy.
 */
export function failLiveTools(
  logs: TaskLogItem[],
  sessionIds?: string[],
  message = 'Stopped'
): { logs: TaskLogItem[]; changed: TaskLogItem[] } {
  const scope = sessionIds ? new Set(sessionIds) : undefined;
  const changed: TaskLogItem[] = [];
  const next = logs.map((log) => {
    if (!log.toolCall || !LIVE_TOOL.has(log.toolCall.status)) return log;
    if (scope && log.sessionId && !scope.has(log.sessionId)) return log;
    const updated: TaskLogItem = {
      ...log,
      text: log.toolCall.output || message,
      toolCall: { ...log.toolCall, status: 'failed', output: log.toolCall.output || message }
    };
    changed.push(updated);
    return updated;
  });
  return { logs: next, changed };
}

/**
 * Entries `incoming` does not know about, kept.
 *
 * `incoming` is the authority for anything it carries: it was serialized after
 * the deltas it contains. The only entries worth keeping from the local copy are
 * ids it has never seen — deltas that streamed in while the request that
 * produced `incoming` was in flight — and those are newer, so they go last.
 */
function unionLogs(previous: TaskLogItem[], incoming: TaskLogItem[], max: number): TaskLogItem[] {
  const usedPrev = new Set<number>();
  const merged = incoming.map((log) => {
    const idx = findMatchingLogIndex(previous, log, usedPrev);
    if (idx < 0) return log;
    usedPrev.add(idx);
    return combineLogItems(previous[idx]!, log);
  });
  const extra = previous.filter((_, i) => !usedPrev.has(i));
  if (extra.length === 0) return capLogs(merged, max);
  return capLogs(sortLogs([...merged, ...extra]), max);
}

/**
 * Which session an untagged log (a column move, a permission notice, a row from
 * before logs were tagged at all) was written in: the main session that was
 * current then — the latest one started at or before it, else the first.
 * A side session owns none; it only sees what was untagged after it started.
 */
function untaggedOwner(timestamp: number, mains: TaskSessionLink[]): string | undefined {
  let owner = mains[0]?.sessionId;
  for (const link of mains) {
    if ((link.createdAt || 0) <= timestamp) owner = link.sessionId;
  }
  return owner;
}

/**
 * Live board logs for one session: its own, and the untagged ones written
 * while it was the one in use. Without that rule every untagged row showed in
 * every session, and a blank session opened on a task with a long untagged
 * past showed all of it.
 *
 * Without `links`, or for a session that is not one of them (a subagent), the
 * old rule stands: untagged entries belong in every view, and a task with no
 * tags at all shows everything rather than nothing.
 */
export function logsForSession(
  logs: TaskLogItem[] | undefined,
  sessionId: string | undefined,
  links?: readonly TaskSessionLink[]
): TaskLogItem[] {
  const all = logs || [];
  if (!sessionId) return all;
  const viewed = links?.find((link) => link.sessionId === sessionId);
  if (!links || !viewed) {
    if (!all.some((log) => log.sessionId)) return all;
    return all.filter((log) => !log.sessionId || log.sessionId === sessionId);
  }
  const mains = links
    .filter((link) => link.kind === 'main')
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const isMain = viewed.kind === 'main';
  return all.filter((log) => {
    if (log.sessionId) return log.sessionId === sessionId;
    if (!isMain) return log.timestamp >= (viewed.createdAt || 0);
    return untaggedOwner(log.timestamp, mains) === sessionId;
  });
}

/**
 * One session's transcript from the board's live stream plus OpenCode's copy.
 *
 * Live and history use different ids for the same turn, so concatenating them
 * duplicates the conversation, and "prefer live if it has any messages"
 * flips the whole list when the two fetches finish in different orders.
 * Match by id / toolCallId / text, keep live ids for in-flight rows, and
 * keep history rows the board never streamed.
 */
export function mergeSessionTranscript(live: TaskLogItem[], history?: TaskLogItem[]): TaskLogItem[] {
  if (!history?.length) return live;
  if (!live.length) return history;

  const usedLive = new Set<number>();
  const result: TaskLogItem[] = [];

  for (const entry of history) {
    const idx = findMatchingLogIndex(live, entry, usedLive);
    if (idx >= 0) {
      usedLive.add(idx);
      result.push(combineLogItems(live[idx]!, entry));
    } else {
      result.push(entry);
    }
  }

  for (let i = 0; i < live.length; i++) {
    if (!usedLive.has(i)) result.push(live[i]!);
  }

  return sortLogs(result);
}

function attributionFromHistory(text: string, history: TaskLogItem[]): TaskLogItem['metadata'] | undefined {
  const needle = text.slice(0, 80);
  for (const entry of history) {
    if (entry.type !== 'agent_say' || !entry.metadata) continue;
    if (!entry.metadata.model && !entry.metadata.agent) continue;
    if (entry.text === text || entry.text.startsWith(needle) || text.startsWith(entry.text.slice(0, 80))) {
      return entry.metadata;
    }
  }
  return undefined;
}

function stampAttribution(logs: TaskLogItem[], history?: TaskLogItem[]): TaskLogItem[] {
  if (!history?.length) return logs;
  return logs.map((log) => {
    if (log.type !== 'agent_say' || log.metadata?.model || log.metadata?.agent) return log;
    const meta = attributionFromHistory(log.text, history);
    return meta ? { ...log, metadata: { ...log.metadata, ...meta } } : log;
  });
}

/** The transcript the drawer renders for one session. */
export function sessionTranscript(
  logs: TaskLogItem[] | undefined,
  sessionId: string | undefined,
  history?: TaskLogItem[],
  links?: readonly TaskSessionLink[]
): TaskLogItem[] {
  return stampAttribution(mergeSessionTranscript(logsForSession(logs, sessionId, links), history), history);
}

function mergeLink(previous: TaskSessionLink | undefined, incoming: TaskSessionLink, max: number): TaskSessionLink {
  if (!previous) return incoming;
  if (!incoming.logsOmitted) {
    return { ...incoming, logs: unionLogs(previous.logs || [], incoming.logs || [], max) };
  }
  return {
    ...incoming,
    logs: previous.logs,
    logsOmitted: previous.logsOmitted
  };
}

/**
 * Merge a task snapshot onto the copy the client already holds.
 *
 * List and push payloads carry `logsOmitted` in place of the transcript, so a
 * snapshot that replaced the local task wholesale would blank the drawer on
 * every status change. Everything but the logs still comes from the snapshot —
 * it is the fresher truth about run state, cost and sessions.
 *
 * `logsOmitted` survives only while the client has never held the real
 * transcript, which is what tells the drawer it still has to fetch one.
 */
export function mergeTaskSnapshot(
  previous: BoardTask | undefined,
  incoming: BoardTask,
  max = MAX_TASK_LOGS
): BoardTask {
  if (!previous) return incoming;

  const previousLinks = new Map((previous.sessions || []).map((link) => [link.sessionId, link]));
  const sessions = incoming.sessions?.map((link) => mergeLink(previousLinks.get(link.sessionId), link, max));

  if (!incoming.logsOmitted) {
    return { ...incoming, logs: unionLogs(previous.logs, incoming.logs, max), sessions };
  }

  return {
    ...incoming,
    logs: previous.logs,
    logsOmitted: previous.logsOmitted,
    sessions
  };
}
