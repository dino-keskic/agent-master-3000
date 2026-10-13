import { DatabaseSync } from 'node:sqlite';
import { V1MessageRow, V1PartRow, convertV1Session } from '../../shared/sessions/v1ToV2.js';
import { openDb } from './db.js';
import { V2_SESSION_TABLE, isV2Schema } from './schemaV2.js';

/**
 * Copying an OpenCode 1.x session into OpenCode 2's tables, so 2.x can load it.
 *
 * OpenCode 2 migrates the 1.x tables once, on its first start. A session that
 * migration never reached is still listed and costed here (`schemaV2.ts` reads
 * the 1.x rows for it), but OpenCode cannot `session/load` it. Before the board
 * loads or forks one, it copies it across the way OpenCode would have — the
 * translation is `shared/sessions/v1ToV2.ts` — together with the rest of its
 * tree: the subagents under it, and whatever it is itself a subagent of.
 *
 * The 1.x rows are left as they were. If OpenCode's own migration is still
 * unfinished (`kv` `migration.v1-v2` short of `completed`) and later gets
 * past whatever stopped it, it will copy the session again over this copy,
 * from those same rows; turns taken since would be lost then. Marking the
 * migration finished ourselves would race an OpenCode that is running it right
 * now and send it back over every session, which is worse.
 *
 * What belongs here: reading the 1.x rows and writing the 2.x ones.
 */

/** Where OpenCode files a session whose project row is gone, as its migration does. */
const GLOBAL_PROJECT = 'global';
const MIGRATION_KEY = 'migration.v1-v2';
/** OpenCode may be writing; wait for it rather than fail the load. */
const BUSY_TIMEOUT_MS = 5_000;

type Row = Record<string, unknown>;

function hasTable(db: DatabaseSync, name: string): boolean {
  return !!db.prepare(`SELECT 1 FROM main.sqlite_master WHERE type = 'table' AND name = ?`).get(name);
}

function columnsOf(db: DatabaseSync, table: string): Set<string> {
  return new Set((db.prepare(`SELECT name FROM pragma_table_info(?, 'main')`).all(table) as { name: string }[]).map((c) => c.name));
}

/** Is this session only in the 1.x tables? */
function isV1Only(db: DatabaseSync, sessionId: string): boolean {
  return !db.prepare(`SELECT 1 FROM main.${V2_SESSION_TABLE} WHERE id = ?`).get(sessionId)
    && !!db.prepare('SELECT 1 FROM main.session WHERE id = ?').get(sessionId);
}

/** Has OpenCode started its own migration of this file? */
function migrationStarted(db: DatabaseSync): boolean {
  if (!hasTable(db, 'kv')) return false;
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(MIGRATION_KEY) as { value?: string } | undefined;
  return typeof row?.value === 'string';
}

/** The session's whole tree in the 1.x tables, root first, as far as 2.x does not have it. */
function v1Tree(db: DatabaseSync, sessionId: string): string[] {
  const parentOf = db.prepare('SELECT parent_id FROM main.session WHERE id = ?');
  const childrenOf = db.prepare('SELECT id FROM main.session WHERE parent_id = ? ORDER BY id');
  let root = sessionId;
  const seen = new Set([root]);
  for (;;) {
    const parent = (parentOf.get(root) as { parent_id?: string | null } | undefined)?.parent_id;
    if (!parent || seen.has(parent) || !db.prepare('SELECT 1 FROM main.session WHERE id = ?').get(parent)) break;
    seen.add(parent);
    root = parent;
  }
  const tree: string[] = [];
  const queue = [root];
  const visited = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    if (isV1Only(db, id)) tree.push(id);
    queue.push(...(childrenOf.all(id) as { id: string }[]).map((r) => r.id));
  }
  return tree;
}

/** Copy one 1.x session, its history translated. Inside the caller's transaction. */
function copySession(db: DatabaseSync, sessionId: string, v2Columns: Set<string>, projects: Set<string>): void {
  const source = db.prepare('SELECT * FROM main.session WHERE id = ?').get(sessionId) as Row | undefined;
  if (!source) return;
  const messages = db.prepare(
    'SELECT id, session_id, time_created, time_updated, data FROM main.message WHERE session_id = ?'
  ).all(sessionId) as unknown as V1MessageRow[];
  const parts = db.prepare(
    'SELECT id, message_id, session_id, time_created, time_updated, data FROM main.part WHERE session_id = ?'
  ).all(sessionId) as unknown as V1PartRow[];
  const converted = convertV1Session(
    { id: sessionId, agent: (source.agent as string | null) ?? null, model: (source.model as string | null) ?? null },
    messages,
    parts
  );

  const now = Date.now();
  const projectId = typeof source.project_id === 'string' && projects.has(source.project_id) ? source.project_id : GLOBAL_PROJECT;
  if (projectId === GLOBAL_PROJECT && !projects.has(GLOBAL_PROJECT)) {
    db.prepare(`INSERT OR IGNORE INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES (?, '/', ?, ?, '[]')`)
      .run(GLOBAL_PROJECT, now, now);
    projects.add(GLOBAL_PROJECT);
  }
  const values: Row = {};
  for (const [column, value] of Object.entries(source)) if (v2Columns.has(column)) values[column] = value;
  Object.assign(values, converted.session, {
    project_id: projectId,
    slug: source.slug || 'session',
    directory: source.directory ?? '',
    version: source.version || '1',
    permission: null,
    revert: null,
    time_compacting: null,
    time_created: Number(source.time_created) || now,
    time_updated: Number(source.time_updated) || now
  });
  const columns = Object.keys(values).filter((c) => v2Columns.has(c));
  db.prepare(
    `INSERT OR IGNORE INTO ${V2_SESSION_TABLE} (${columns.map((c) => `\`${c}\``).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
  ).run(...(columns.map((c) => values[c] ?? null) as never[]));

  db.prepare('DELETE FROM session_message WHERE session_id = ?').run(sessionId);
  const insert = db.prepare(
    'INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  for (const m of converted.messages) {
    insert.run(m.id, m.session_id, m.type, m.seq, m.time_created, m.time_updated, JSON.stringify(m.data));
  }
  // The next prompt is numbered from here; without it 2.x starts at 0 and collides.
  db.prepare(
    'INSERT INTO event_sequence (aggregate_id, seq) VALUES (?, ?) ON CONFLICT (aggregate_id) DO UPDATE SET seq = excluded.seq'
  ).run(sessionId, converted.watermark);
  if (converted.skipped.length) {
    console.warn(`[OpenCode DB] Left ${converted.skipped.length} unreadable 1.x row(s) out of ${sessionId}`);
  }
}

/**
 * Make a 1.x-only session loadable on OpenCode 2, along with its tree.
 * Returns the sessions copied: none when the file is not 2.x, the session is
 * already there, or OpenCode has not yet begun the migration it will do itself.
 */
export function adoptV1Session(sessionId: string): string[] {
  const db = openDb(false);
  if (!db) return [];
  try {
    if (!isV2Schema(db) || !hasTable(db, 'session') || !hasTable(db, 'message') || !hasTable(db, 'part')) return [];
    if (!isV1Only(db, sessionId) || !migrationStarted(db)) return [];
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    const v2Columns = columnsOf(db, V2_SESSION_TABLE);
    const projects = new Set((db.prepare('SELECT id FROM project').all() as { id: string }[]).map((r) => r.id));
    // All or nothing: half a tree would load a session whose subagents 2.x cannot find.
    db.exec('BEGIN IMMEDIATE');
    const copied = v1Tree(db, sessionId);
    for (const id of copied) copySession(db, id, v2Columns, projects);
    db.exec('COMMIT');
    if (copied.length) console.log(`[OpenCode DB] Copied ${copied.length} OpenCode 1.x session(s) into OpenCode 2: ${copied.join(', ')}`);
    return copied;
  } catch (e) {
    if (db.isTransaction) db.exec('ROLLBACK');
    console.warn('[OpenCode DB] Could not copy 1.x session', sessionId, e);
    return [];
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}
