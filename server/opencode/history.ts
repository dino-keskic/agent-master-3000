import { DatabaseSync } from 'node:sqlite';
import { TaskLogItem } from '../../shared/types.js';
import { isSubagentTool, replayedToolStatus, toolKind } from '../../shared/agent/toolCall.js';
import { codeModeCalls } from '../../shared/agent/codeMode.js';
import { turnAttributionFromMessage } from '../../shared/turns/attribution.js';
import { parseSessionModel } from './models.js';
import { readDb } from './db.js';
import { SubagentResolver, subagentResolver } from './subagentLinks.js';

const MAX_IMPORT_LOGS = 250;
const MAX_IMPORT_TEXT = 4_000;
const MAX_HISTORY_MESSAGES = 120;

function clipImportText(text: string): string {
  if (text.length <= MAX_IMPORT_TEXT) return text;
  return `${text.slice(0, MAX_IMPORT_TEXT)}\n…`;
}

export interface SessionHistory {
  logs: TaskLogItem[];
  model?: string;
  agent?: string;
  /** Highest `part.time_updated` this read saw — feed it back as `since` next time. */
  watermark?: number;
}

interface PartRow {
  id: string;
  timeCreated: number;
  partData: string;
  messageData: string;
}

interface PartWindow {
  rows: PartRow[];
  /** Where the next incremental read should pick up. */
  watermark: number;
}

/**
 * The parts worth reading for this session, newest messages first.
 *
 * `part` is indexed by message_id, not session_id. Loading every part for a
 * long session (hundreds of MB of tool JSON) is what made the drawer hang. So
 * take the newest messages via the session index, then their parts — enough to
 * fill MAX_IMPORT_LOGS. Ids only: `message_session_time_created_id_idx` covers
 * that first query, so picking the window costs no row reads. The `data` blobs
 * come later, and only for the messages that turn out to own a returned part —
 * an incremental read that finds nothing new then reads nothing at all.
 */
function readPartWindow(db: DatabaseSync, sessionId: string, since: number): PartWindow {
  let watermark = since;
  try {
    const recent = db.prepare(
      `SELECT id FROM message WHERE session_id = ? ORDER BY time_created DESC, id DESC LIMIT ?`
    ).all(sessionId, MAX_HISTORY_MESSAGES) as { id: string }[];
    recent.reverse();
    if (recent.length === 0) return { rows: [], watermark };

    const placeholders = recent.map(() => '?').join(', ');
    const parts = db.prepare(
      `SELECT id, message_id, time_created, time_updated, data
       FROM part
       WHERE session_id = ? AND message_id IN (${placeholders})${since > 0 ? ' AND time_updated > ?' : ''}
       ORDER BY time_created, id`
    ).all(
      sessionId,
      ...recent.map((row) => row.id),
      ...(since > 0 ? [since] : [])
    ) as { id: string; message_id: string; time_created: number; time_updated: number; data: string }[];
    for (const part of parts) {
      const at = Number(part.time_updated);
      if (Number.isFinite(at) && at > watermark) watermark = at;
    }
    if (parts.length === 0) return { rows: [], watermark };

    const ownerIds = [...new Set(parts.map((part) => part.message_id))];
    const ownerPlaceholders = ownerIds.map(() => '?').join(', ');
    const owners = db.prepare(
      `SELECT id, data FROM message WHERE id IN (${ownerPlaceholders})`
    ).all(...ownerIds) as { id: string; data: string }[];
    const messageData = new Map(owners.map((row) => [row.id, row.data]));

    return {
      watermark,
      rows: parts.map((part) => ({
        id: part.id,
        timeCreated: part.time_created,
        partData: part.data,
        messageData: messageData.get(part.message_id) || '{}'
      }))
    };
  } catch {
    return { rows: [], watermark: since };
  }
}

interface ParsedPart {
  part: any;
  message: any;
  timestamp: number;
}

/** Undefined for a part that is unreadable or carries nothing to show. */
function parsePartRow(row: PartRow): ParsedPart | undefined {
  let part: any;
  try { part = JSON.parse(row.partData); } catch { return undefined; }
  if (part?.type === 'step-start' || part?.type === 'step-finish') return undefined;
  let message: any;
  try { message = JSON.parse(row.messageData); } catch { message = {}; }
  return { part, message, timestamp: Number(part?.time?.start || row.timeCreated) || row.timeCreated };
}

function textLog(id: string, { part, message, timestamp }: ParsedPart): TaskLogItem | undefined {
  if (typeof part.text !== 'string' || !part.text.trim()) return undefined;
  const isUser = message?.role === 'user';
  const attr = isUser ? undefined : turnAttributionFromMessage(message);
  return {
    id,
    timestamp,
    type: isUser ? 'user_say' : 'agent_say',
    title: isUser ? 'User Prompt' : 'OpenCode Agent',
    text: clipImportText(part.text),
    metadata: attr && (attr.model || attr.agent || attr.thinkingLevel) ? { ...attr } : undefined
  };
}

function reasoningLog(id: string, { part, timestamp }: ParsedPart): TaskLogItem | undefined {
  if (typeof part.text !== 'string' || !part.text.trim()) return undefined;
  return {
    id,
    timestamp,
    type: 'thought',
    title: 'Agent Thought Process',
    text: clipImportText(part.text),
    metadata: part.time?.end && part.time?.start
      ? { durationMs: Number(part.time.end) - Number(part.time.start) }
      : undefined
  };
}

function toolLog(id: string, { part, timestamp }: ParsedPart, resolveSubagent: SubagentResolver): TaskLogItem {
  const name = String(part.tool || part.title || 'tool');
  const state = part.state || {};
  const output = typeof state.output === 'string' ? clipImportText(state.output) : undefined;
  const filePath = state.input?.filePath || state.input?.path;
  const subagent = isSubagentTool(name) ? resolveSubagent(part, timestamp) : undefined;
  const rawInput = state.input && typeof state.input === 'object' ? state.input : undefined;
  const ran = codeModeCalls({ name, rawInput }, state.metadata);
  return {
    id,
    timestamp,
    type: 'tool_call',
    title: name,
    text: output || '',
    toolCall: {
      toolCallId: String(part.callID || id),
      name,
      kind: toolKind(name),
      status: replayedToolStatus(state.status),
      rawInput,
      output,
      locations: typeof filePath === 'string' ? [filePath] : undefined,
      ...(ran ? { codeModeCalls: ran } : {}),
      ...subagent
    }
  };
}

function logForPart(id: string, parsed: ParsedPart, resolveSubagent: SubagentResolver): TaskLogItem | undefined {
  switch (parsed.part?.type) {
    case 'text': return textLog(id, parsed);
    case 'reasoning': return reasoningLog(id, parsed);
    case 'tool': return toolLog(id, parsed, resolveSubagent);
    default: return undefined;
  }
}

function historyLogs(db: DatabaseSync, sessionId: string, rows: PartRow[]): TaskLogItem[] {
  const resolveSubagent = subagentResolver(db, sessionId);
  const logs: TaskLogItem[] = [];
  for (const row of rows) {
    const parsed = parsePartRow(row);
    if (!parsed) continue;
    const log = logForPart(row.id, parsed, resolveSubagent);
    if (log) logs.push(log);
  }
  return logs.length > MAX_IMPORT_LOGS ? logs.slice(-MAX_IMPORT_LOGS) : logs;
}

/**
 * Build board logs from the local OpenCode DB — no ACP replay.
 *
 * `since` is the caller's watermark: pass the `watermark` from the previous
 * read and only parts written after it come back. The poll loop runs this
 * every few seconds against sessions whose recent messages carry megabytes of
 * tool JSON, and re-parsing all of it to discover that one part moved was the
 * single most expensive thing this process did. Parts are updated in place
 * (streaming text, a tool leaving `running`) and `time_updated` moves when
 * they are, so the filter never hides an edit to an older part.
 *
 * `since = 0` — the default, and what opening a task uses — reads the whole
 * window as before.
 */
export function loadSessionHistory(sessionId: string, since = 0): SessionHistory {
  const db = readDb();
  if (!db) return { logs: [] };

  try {
    const session = db.prepare('SELECT agent, model FROM session WHERE id = ?').get(sessionId) as
      | { agent?: string; model?: string }
      | undefined;
    const parsed = parseSessionModel(session?.model);
    const model = parsed.provider && parsed.id ? `${parsed.provider}/${parsed.id}` : parsed.id;
    const agent = session?.agent || undefined;

    const { rows, watermark } = readPartWindow(db, sessionId, since);
    return { logs: historyLogs(db, sessionId, rows), model, agent, watermark };
  } catch (e) {
    console.warn('[OpenCode DB] load session history failed:', e);
    return { logs: [] };
  }
}
