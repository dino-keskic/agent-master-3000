import { randomBytes } from 'crypto';
import { openDb } from './db.js';
import { findProject } from './projects.js';
import { V2_SESSION_TABLE, isV2Schema } from './schemaV2.js';

function randomSuffix(): string {
  return Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
}

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Hands out ids in OpenCode's ascending format — 12 hex digits of
 * `ms * 0x1000 + counter`, then random base62 — each sorting after the last.
 *
 * Order matters: OpenCode reads a message's parts `ORDER BY id`, so random ids
 * shuffle them. A reasoning part that lands after the text or tool call it
 * preceded is sent back to Anthropic out of place, which rejects the request
 * ("`thinking` or `redacted_thinking` blocks ... cannot be modified").
 */
function ascendingIds(start: number): (prefix: string) => string {
  let next = BigInt(start) * 0x1000n;
  return (prefix) => {
    const hex = (next++ & 0xffffffffffffn).toString(16).padStart(12, '0');
    const tail = Array.from(randomBytes(14), (byte) => BASE62[byte % 62]).join('');
    return `${prefix}_${hex}${tail}`;
  };
}

/** Columns whose value identifies the row rather than describing the work. */
const SESSION_IDENTITY_COLUMNS = new Set([
  'id',
  'parent_id',
  'slug',
  'title',
  'time_created',
  'time_updated',
  'time_archived',
  'share_url'
]);

type Row = Record<string, unknown>;
type WritableDb = NonNullable<ReturnType<typeof openDb>>;

/** Insert `source` with `overrides` applied, column for column, whatever columns it has. */
function insertCopy(db: WritableDb, table: string, source: Row, overrides: Row): void {
  const columns = Object.keys(source);
  const values = columns.map((column) =>
    SESSION_IDENTITY_COLUMNS.has(column) || column in overrides
      ? overrides[column] ?? null
      : (source[column] ?? null)
  );
  const placeholders = columns.map(() => '?').join(', ');
  db.prepare(
    `INSERT INTO ${table} (${columns.map((c) => `\`${c}\``).join(', ')}) VALUES (${placeholders})`
  ).run(...(values as never[]));
}

/** OpenCode 1.x: a `message` row each, and a `part` row per part under it. */
function copyV1Messages(db: WritableDb, sourceSessionId: string, newSessionId: string, now: number): void {
  // Read in the order OpenCode does, and number the copies in that order.
  const messages = db
    .prepare('SELECT * FROM message WHERE session_id = ? ORDER BY time_created, id')
    .all(sourceSessionId) as Row[];
  const partsFor = db.prepare('SELECT * FROM part WHERE message_id = ? ORDER BY id');
  const insertMessage = db.prepare(`
    INSERT INTO message (id, session_id, time_created, time_updated, data)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertPart = db.prepare(`
    INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const nextId = ascendingIds(now);

  for (const message of messages) {
    const newMessageId = nextId('msg');
    insertMessage.run(
      newMessageId,
      newSessionId,
      (message.time_created as number) || now,
      (message.time_updated as number) || now,
      (message.data as string) || '{}'
    );

    const parts = partsFor.all(message.id as string) as Row[];
    for (const part of parts) {
      insertPart.run(
        nextId('prt'),
        newMessageId,
        newSessionId,
        (part.time_created as number) || now,
        (part.time_updated as number) || now,
        (part.data as string) || '{}'
      );
    }
  }
}

/**
 * OpenCode 2: one `session_message` row per entry, parts inside it, ordered by
 * `seq` — which is unique per session and handed out from the session's
 * counter in `event_sequence`. The copy keeps every `seq` and starts its own
 * counter where the source's stands; without that row OpenCode numbers the
 * next prompt from zero and it collides with the copied history. This is
 * what OpenCode's own fork writes, less the pointer back to the source: a copy
 * made here stands on its own.
 */
function copyV2Messages(db: WritableDb, sourceSessionId: string, newSessionId: string, now: number): void {
  const messages = db
    .prepare('SELECT * FROM session_message WHERE session_id = ? ORDER BY seq')
    .all(sourceSessionId) as Row[];
  const insertMessage = db.prepare(`
    INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const nextId = ascendingIds(now);
  let lastSeq = 0;
  for (const message of messages) {
    const seq = Number(message.seq) || 0;
    lastSeq = Math.max(lastSeq, seq);
    insertMessage.run(
      nextId('msg'),
      newSessionId,
      String(message.type),
      seq,
      (message.time_created as number) || now,
      (message.time_updated as number) || now,
      (message.data as string) || '{}'
    );
  }
  const counter = db.prepare('SELECT seq FROM event_sequence WHERE aggregate_id = ?').get(sourceSessionId) as
    | { seq: number }
    | undefined;
  db.prepare('INSERT INTO event_sequence (aggregate_id, seq) VALUES (?, ?)')
    .run(newSessionId, Math.max(lastSeq, Number(counter?.seq) || 0));
}

/**
 * Copy an OpenCode session — row, messages, and parts — into a new session that
 * starts out knowing everything the original knew.
 *
 * Two things this deliberately does *not* do:
 *
 * - It does not name the source as `parent_id`. In OpenCode that column means
 *   "subagent of", and it is load-bearing: costs roll up through it, stopping a
 *   session closes everything under it, and `parent_id IS NULL` is what makes a
 *   session appear in the session list at all. A fork is a sibling, not a child;
 *   the board records where it came from in `TaskSessionLink.forkedFrom`.
 *
 * - It does not spell out the column list. The schema gains columns between
 *   OpenCode releases — `slug` and `version` are both NOT NULL and were both
 *   absent from the original hand-written INSERT, so every fork failed — so the
 *   copy is driven by whatever columns the row actually has.
 *
 * OpenCode 2 keeps the same session columns in `session_v2` and the messages
 * in a table of its own; see `schemaV2.ts`.
 */
export function cloneOpenCodeSession(
  sourceSessionId: string,
  newTitle?: string,
  /** File the copy under another folder (and that folder's project) — a handoff. */
  placement?: { directory: string }
): { sessionId: string; costAtFork: number } | null {
  const db = openDb(false);
  if (!db) return null;
  try {
    const v2 = isV2Schema(db);
    const sessionTable = v2 ? V2_SESSION_TABLE : 'session';
    const source = db.prepare(`SELECT * FROM ${sessionTable} WHERE id = ?`).get(sourceSessionId) as
      | Row
      | undefined;
    if (!source) return null;

    const newSessionId = `ses_${randomSuffix()}`;
    const now = Date.now();
    const costAtFork = Number(source.cost) || 0;
    const sourceTitle = typeof source.title === 'string' ? source.title : '';
    const sourceSlug = typeof source.slug === 'string' && source.slug ? source.slug : 'session';

    const overrides: Row = {
      id: newSessionId,
      parent_id: null,
      slug: `${sourceSlug}-fork-${randomSuffix().slice(0, 6)}`,
      title: newTitle || (sourceTitle ? `Fork: ${sourceTitle}` : 'Side chat'),
      time_created: now,
      time_updated: now,
      time_archived: null,
      share_url: null
    };
    if (v2) {
      overrides.fork_session_id = null;
      overrides.fork_boundary = null;
    }
    if (placement) {
      // OpenCode routes every request about a session to its `directory`, so
      // this is what really moves it; the project keeps its session list right.
      overrides.directory = placement.directory;
      overrides.project_id = findProject(db, placement.directory)?.id ?? source.project_id;
      overrides.slug = `${sourceSlug}-moved-${randomSuffix().slice(0, 6)}`;
    }

    // All or nothing: a copy that stops halfway would take over holding only
    // part of the conversation.
    db.exec('BEGIN IMMEDIATE');
    insertCopy(db, sessionTable, source, overrides);
    if (v2) copyV2Messages(db, sourceSessionId, newSessionId, now);
    else copyV1Messages(db, sourceSessionId, newSessionId, now);
    db.exec('COMMIT');
    return { sessionId: newSessionId, costAtFork };
  } catch (e) {
    if (db.isTransaction) db.exec('ROLLBACK');
    console.warn('[OpenCode DB] Clone session failed:', e);
    return null;
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}
