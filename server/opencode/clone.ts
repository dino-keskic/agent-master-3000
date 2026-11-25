import { randomBytes } from 'crypto';
import {
  V1MessageLike,
  V1PartLike,
  V2MessageLike,
  pruneV1Parts,
  pruneV2Messages,
  trimV1Tail,
  trimV2Tail
} from '../../shared/sessions/pruneImages.js';
import { sliceMessagesForFork, sliceV2MessagesForFork } from '../../shared/transcript/forkPoint.js';
import { openDb } from './db.js';
import { adoptV1Session } from './migrateV1.js';
import { findProject } from './projects.js';
import { V2_SESSION_TABLE, isV2Schema } from './schemaV2.js';

const BUSY_TIMEOUT_MS = 5_000;

export interface ImagePruneOptions {
  keepImages: number;
  dropSinceMs?: number;
  retryPromptText?: string;
}

export interface CloneSessionOptions {
  /** File the copy under another folder (and that folder's project) — a handoff. */
  directory?: string;
  /** Copy conversation only up to this message id (inclusive unless `exclusive` is true). */
  upToMessageId?: string;
  /** Exclude `upToMessageId` itself — used when re-branching before a user prompt. */
  exclusive?: boolean;
}

export interface PrunedCloneResult {
  sessionId: string;
  costAtFork: number;
  removedImages: number;
  keptImages: number;
}

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

function messageCost(data: unknown): number {
  if (typeof data !== 'string') return 0;
  try {
    const parsed = JSON.parse(data) as { cost?: unknown };
    const n = Number(parsed?.cost);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

interface CopyResult {
  removedImages: number;
  keptImages: number;
  copiedCost: number;
}

/** OpenCode 1.x: a `message` row each, and a `part` row per part under it. */
function copyV1Messages(
  db: WritableDb,
  sourceSessionId: string,
  newSessionId: string,
  now: number,
  options: { prune?: ImagePruneOptions; upToMessageId?: string; exclusive?: boolean }
): CopyResult | null {
  // Read in the order OpenCode does, and number the copies in that order.
  const rawMessages = db
    .prepare('SELECT * FROM message WHERE session_id = ? ORDER BY time_created, id')
    .all(sourceSessionId) as (Row & V1MessageLike)[];
  const scoped = options.upToMessageId
    ? sliceMessagesForFork(rawMessages, options.upToMessageId, options.exclusive)
    : rawMessages;
  if (!scoped) return null;

  const partsFor = db.prepare('SELECT * FROM part WHERE message_id = ? ORDER BY id');
  const rawPartsMap = new Map<string, (Row & V1PartLike)[]>();
  const partsOfMessage = (msgId: string) => {
    let cached = rawPartsMap.get(msgId);
    if (!cached) {
      cached = partsFor.all(msgId) as (Row & V1PartLike)[];
      rawPartsMap.set(msgId, cached);
    }
    return cached;
  };

  const { prune } = options;
  const messages = prune
    ? trimV1Tail(scoped, prune.dropSinceMs, (msgId) => {
        const ps = partsOfMessage(msgId);
        if (ps.length === 0) return true;
        const expected = prune.retryPromptText?.trim();
        if (!expected) return false;
        const text = ps
          .map((p) => {
            try {
              const parsed = JSON.parse(p.data) as { type?: string; text?: string };
              return parsed.type === 'text' && typeof parsed.text === 'string' ? parsed.text : '';
            } catch {
              return '';
            }
          })
          .filter(Boolean)
          .join('\n')
          .trim();
        return text === expected;
      })
    : scoped;

  const orderedParts = messages.flatMap((message) => partsOfMessage(message.id));
  const pruned = prune ? pruneV1Parts(orderedParts, prune.keepImages) : undefined;
  const partMap = new Map<string, (Row & V1PartLike)[]>();
  for (const part of pruned ? pruned.items : orderedParts) {
    const list = partMap.get(part.message_id);
    if (list) list.push(part);
    else partMap.set(part.message_id, [part]);
  }

  const insertMessage = db.prepare(`
    INSERT INTO message (id, session_id, time_created, time_updated, data)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertPart = db.prepare(`
    INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const nextId = ascendingIds(now);
  let copiedCost = 0;

  for (const message of messages) {
    copiedCost += messageCost(message.data);
    const newMessageId = nextId('msg');
    insertMessage.run(
      newMessageId,
      newSessionId,
      message.time_created || now,
      (message.time_updated as number) || now,
      message.data || '{}'
    );

    const parts = partMap.get(message.id) ?? [];
    for (const part of parts) {
      insertPart.run(
        nextId('prt'),
        newMessageId,
        newSessionId,
        part.time_created || now,
        part.time_updated || now,
        part.data || '{}'
      );
    }
  }
  return {
    removedImages: pruned?.removedImages ?? 0,
    keptImages: pruned?.keptImages ?? 0,
    copiedCost
  };
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
function copyV2Messages(
  db: WritableDb,
  sourceSessionId: string,
  newSessionId: string,
  now: number,
  options: { prune?: ImagePruneOptions; upToMessageId?: string; exclusive?: boolean }
): CopyResult | null {
  const rawMessages = db
    .prepare('SELECT * FROM session_message WHERE session_id = ? ORDER BY seq')
    .all(sourceSessionId) as (Row & V2MessageLike)[];

  let scoped: (Row & V2MessageLike)[];
  let seedSeq: number;
  if (options.upToMessageId) {
    const sliced = sliceV2MessagesForFork(rawMessages, options.upToMessageId, options.exclusive);
    if (!sliced) return null;
    scoped = sliced.items;
    seedSeq = sliced.lastSeq;
  } else {
    scoped = rawMessages;
    let lastSeq = 0;
    for (const message of rawMessages) {
      lastSeq = Math.max(lastSeq, Number(message.seq) || 0);
    }
    const counter = db.prepare('SELECT seq FROM event_sequence WHERE aggregate_id = ?').get(sourceSessionId) as
      | { seq: number }
      | undefined;
    seedSeq = Math.max(lastSeq, Number(counter?.seq) || 0);
  }

  const { prune } = options;
  const trimmed = prune ? trimV2Tail(scoped, prune.dropSinceMs, prune.retryPromptText) : scoped;
  const pruned = prune ? pruneV2Messages(trimmed, prune.keepImages) : undefined;
  const messages = pruned ? pruned.items : trimmed;

  const insertMessage = db.prepare(`
    INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const nextId = ascendingIds(now);
  let copiedCost = 0;
  for (const message of messages) {
    if (message.type === 'assistant') copiedCost += messageCost(message.data);
    insertMessage.run(
      nextId('msg'),
      newSessionId,
      String(message.type),
      Number(message.seq) || 0,
      message.time_created || now,
      message.time_updated || now,
      message.data || '{}'
    );
  }
  db.prepare('INSERT INTO event_sequence (aggregate_id, seq) VALUES (?, ?)').run(newSessionId, seedSeq);
  return {
    removedImages: pruned?.removedImages ?? 0,
    keptImages: pruned?.keptImages ?? 0,
    copiedCost
  };
}

function cloneInternal(
  sourceSessionId: string,
  options: {
    newTitle?: string;
    directory?: string;
    prune?: ImagePruneOptions;
    upToMessageId?: string;
    exclusive?: boolean;
  }
): PrunedCloneResult | null {
  // On 2.x a session its migration never reached has to be brought over before it can be copied.
  adoptV1Session(sourceSessionId);
  const db = openDb(false);
  if (!db) return null;
  try {
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    const v2 = isV2Schema(db);
    const sessionTable = v2 ? V2_SESSION_TABLE : 'session';
    const source = db.prepare(`SELECT * FROM ${sessionTable} WHERE id = ?`).get(sourceSessionId) as
      | Row
      | undefined;
    if (!source) return null;

    const newSessionId = `ses_${randomSuffix()}`;
    const now = Date.now();
    const sourceCost = Number(source.cost) || 0;
    const sourceTitle = typeof source.title === 'string' ? source.title : '';
    const sourceSlug = typeof source.slug === 'string' && source.slug ? source.slug : 'session';
    const fallbackTitle = options.prune
      ? sourceTitle || 'Session'
      : sourceTitle
        ? `Fork: ${sourceTitle}`
        : 'Side chat';

    const overrides: Row = {
      id: newSessionId,
      parent_id: null,
      slug: `${sourceSlug}-${options.prune ? 'trimmed' : 'fork'}-${randomSuffix().slice(0, 6)}`,
      title: options.newTitle || fallbackTitle,
      time_created: now,
      time_updated: now,
      time_archived: null,
      share_url: null
    };
    if (v2) {
      overrides.fork_session_id = null;
      overrides.fork_boundary = null;
    }
    if (options.directory) {
      // OpenCode routes every request about a session to its `directory`, so
      // this is what really moves it; the project keeps its session list right.
      overrides.directory = options.directory;
      overrides.project_id = findProject(db, options.directory)?.id ?? source.project_id;
      overrides.slug = `${sourceSlug}-moved-${randomSuffix().slice(0, 6)}`;
    }

    // All or nothing: a copy that stops halfway would take over holding only
    // part of the conversation.
    db.exec('BEGIN IMMEDIATE');
    insertCopy(db, sessionTable, source, overrides);
    const copyOpts = {
      prune: options.prune,
      upToMessageId: options.upToMessageId,
      exclusive: options.exclusive
    };
    const copied = v2
      ? copyV2Messages(db, sourceSessionId, newSessionId, now, copyOpts)
      : copyV1Messages(db, sourceSessionId, newSessionId, now, copyOpts);
    if (!copied) {
      db.exec('ROLLBACK');
      return null;
    }
    const costAtFork = options.upToMessageId ? copied.copiedCost : sourceCost;
    if (options.upToMessageId && 'cost' in source) {
      db.prepare(`UPDATE ${sessionTable} SET cost = ? WHERE id = ?`).run(costAtFork, newSessionId);
    }
    db.exec('COMMIT');
    return {
      sessionId: newSessionId,
      costAtFork,
      removedImages: copied.removedImages,
      keptImages: copied.keptImages
    };
  } catch (e) {
    if (db.isTransaction) db.exec('ROLLBACK');
    console.warn('[OpenCode DB] Clone session failed:', e);
    return null;
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
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
  /** Optional placement (handoff folder) and/or fork cut-point. */
  options?: CloneSessionOptions
): { sessionId: string; costAtFork: number } | null {
  const res = cloneInternal(sourceSessionId, {
    newTitle,
    directory: options?.directory,
    upToMessageId: options?.upToMessageId,
    exclusive: options?.exclusive
  });
  return res ? { sessionId: res.sessionId, costAtFork: res.costAtFork } : null;
}

/**
 * Fork a session cleanly while stripping the oldest historical images down to
 * `keepImages`, used to recover from strict model image caps.
 */
export function cloneSessionWithoutExcessImages(
  sourceSessionId: string,
  newTitle: string | undefined,
  options: ImagePruneOptions & { directory?: string }
): PrunedCloneResult | null {
  return cloneInternal(sourceSessionId, {
    newTitle,
    directory: options.directory,
    prune: {
      keepImages: options.keepImages,
      dropSinceMs: options.dropSinceMs,
      retryPromptText: options.retryPromptText
    }
  });
}
