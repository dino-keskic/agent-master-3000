import { DatabaseSync } from 'node:sqlite';

/**
 * OpenCode 2's database, made to read like OpenCode 1's.
 *
 * OpenCode 2 replaced the three tables every reader here is written against —
 * `session`, `message`, and `part` — with `session_v2` and `session_message`.
 * A message's parts live inside its own row now (`data.content[]`), and a
 * user prompt carries its text inline. Migrating a 1.x database copies the
 * history across and leaves the old tables where they were, frozen; from then
 * on only the new ones move.
 *
 * Not every 1.x session makes it: the migration runs once, newest first, and a
 * row it chokes on stops it for good, while a 1.x install still writing to the
 * file adds sessions it will never go back for. Those are only in the 1.x
 * tables, so each view also carries the 1.x rows of every session `session_v2`
 * does not have — their cost counts, they are listed, their history reads —
 * until `migrateV1.ts` copies one across to be resumed.
 *
 * Rather than teach a dozen readers two dialects, each read handle on a 2.x
 * database gets TEMP views named after the 1.x tables, shaped the way 1.x
 * wrote them. The temp schema is searched before `main`, so a view shadows the
 * frozen 1.x table of the same name, and it lives in the connection, not the
 * file: a read-only handle can make them, and OpenCode never sees them.
 *
 * What belongs here: the shape of that translation, and nothing else. Writes
 * cannot go through a view — `clone.ts` speaks 2.x for itself.
 */

/** OpenCode 2's sessions table. Its presence is what makes a database 2.x. */
export const V2_SESSION_TABLE = 'session_v2';

export function isV2Schema(db: DatabaseSync): boolean {
  try {
    return !!db.prepare(`SELECT 1 FROM main.sqlite_master WHERE type = 'table' AND name = ?`).get(V2_SESSION_TABLE);
  } catch {
    return false;
  }
}

/**
 * The newest value of `field` in a session's own rows of these types. 2.x
 * leaves `session_v2.agent` and `.model` empty until something switches them,
 * and records the switch as a row of its own, so the session's model is
 * whichever came last: an answer, or a switch since.
 */
function latestFromMessages(field: string, types: string[]): string {
  return `(SELECT json_extract(m.data, '$.${field}') FROM main.session_message m
           WHERE m.session_id = s.id AND m.type IN (${types.map((t) => `'${t}'`).join(', ')})
           ORDER BY m.seq DESC LIMIT 1)`;
}

/** The `session` view's columns, in order; a 1.x row is read into the same ones. */
const SESSION_COLUMNS = [
  'id', 'project_id', 'workspace_id', 'parent_id', 'slug', 'directory', 'path', 'title',
  'version', 'share_url', 'summary_additions', 'summary_deletions', 'summary_files',
  'summary_diffs', 'metadata', 'cost', 'tokens_input', 'tokens_output', 'tokens_reasoning',
  'tokens_cache_read', 'tokens_cache_write', 'revert', 'permission', 'agent', 'model',
  'time_created', 'time_updated', 'time_compacting', 'time_archived'
];

const SESSION_VIEW = `
CREATE TEMP VIEW IF NOT EXISTS session AS
SELECT s.id, s.project_id, s.workspace_id, s.parent_id, s.slug, s.directory, s.path, s.title,
       s.version, s.share_url, s.summary_additions, s.summary_deletions, s.summary_files,
       s.summary_diffs, s.metadata, s.cost, s.tokens_input, s.tokens_output, s.tokens_reasoning,
       s.tokens_cache_read, s.tokens_cache_write, s.revert, s.permission,
       COALESCE(s.agent, ${latestFromMessages('agent', ['assistant', 'agent-switched'])}) AS agent,
       COALESCE(s.model, ${latestFromMessages('model', ['assistant', 'model-switched'])}) AS model,
       s.time_created, s.time_updated, s.time_compacting, s.time_archived
FROM main.session_v2 s`;

/**
 * Only prompts and answers were messages in 1.x. The rest of 2.x's row types
 * (\`idle\`, \`system\`, a model switch) are bookkeeping, and letting them in
 * would make a session look as if its last message were not the answer.
 *
 * An answer keeps every field it had, less the parts (which are the `part`
 * view's) and the snapshot, plus the top-level names 1.x put the model and
 * agent under.
 */
const MESSAGE_VIEW = `
CREATE TEMP VIEW IF NOT EXISTS message AS
SELECT m.id, m.session_id, m.time_created, m.time_updated,
       CASE m.type
         WHEN 'user' THEN json_object('role', 'user', 'time', m.data -> '$.time')
         ELSE json_set(json_remove(m.data, '$.content', '$.snapshot'),
                       '$.role', 'assistant',
                       '$.mode', m.data ->> '$.agent',
                       '$.modelID', m.data ->> '$.model.id',
                       '$.providerID', m.data ->> '$.model.providerID',
                       '$.variant', m.data ->> '$.model.variant')
       END AS data
FROM main.session_message m
WHERE m.type IN ('user', 'assistant')`;

/**
 * A tool's result was a string (`state.output`) in 1.x and is a list of
 * content blocks now; the text blocks, joined, are the same thing. Its times
 * were `start`/`end`, and `ran` is the moment the tool itself started.
 */
const TOOL_PART = `json_object(
  'type', 'tool',
  'tool', c.value ->> '$.name',
  'callID', c.value ->> '$.id',
  'state', json_object(
    'status', c.value ->> '$.state.status',
    'input', c.value -> '$.state.input',
    'output', COALESCE(
      (SELECT group_concat(o.value ->> '$.text', '') FROM json_each(c.value, '$.state.content') o
       WHERE o.value ->> '$.type' = 'text'),
      c.value ->> '$.state.error'),
    'metadata', c.value -> '$.state.metadata',
    'title', c.value ->> '$.state.input.description',
    'time', json_object(
      'start', COALESCE(c.value ->> '$.time.ran', c.value ->> '$.time.created'),
      'end', c.value ->> '$.time.completed')))`;

const REASONING_PART = `json_object(
  'type', 'reasoning',
  'text', c.value ->> '$.text',
  'time', json_object('start', c.value ->> '$.time.created', 'end', c.value ->> '$.time.completed'))`;

/**
 * One row per entry in an answer's `content`, plus one text part per prompt.
 *
 * Ids are the message's id and the entry's position, zero-padded: readers put
 * a message's parts in `id` order, and that order has to be the one the
 * entries were written in. For the same reason every part of a message is
 * dated by the message — most entries carry no time of their own, and dating
 * the few that do would shuffle them ahead of their neighbours. A part's
 * `time_updated` is its message's, which moves whenever any of it does.
 */
const PART_VIEW = `
CREATE TEMP VIEW IF NOT EXISTS part AS
SELECT m.id || ':text' AS id, m.id AS message_id, m.session_id, m.time_created, m.time_updated,
       json_object('type', 'text', 'text', m.data ->> '$.text') AS data
FROM main.session_message m
WHERE m.type = 'user'
UNION ALL
SELECT m.id || ':' || printf('%05d', c.key), m.id, m.session_id, m.time_created, m.time_updated,
       CASE c.value ->> '$.type'
         WHEN 'tool' THEN ${TOOL_PART}
         WHEN 'reasoning' THEN ${REASONING_PART}
         ELSE c.value
       END
FROM main.session_message m, json_each(m.data, '$.content') c
WHERE m.type = 'assistant'`;

/** The columns of one of `main`'s tables; none if it is not there. */
function columnsOf(db: DatabaseSync, table: string): Set<string> {
  return new Set((db.prepare(`SELECT name FROM pragma_table_info(?, 'main')`).all(table) as { name: string }[]).map((c) => c.name));
}

/** Sessions only the 1.x tables have. */
const V1_ONLY = (column: string) => `NOT EXISTS (SELECT 1 FROM main.session_v2 v2 WHERE v2.id = ${column})`;

/**
 * The 1.x rows of sessions 2.x never took in, for each view to append. Each
 * 1.x table is read column for column in the view's order, as NULL where an
 * older 1.x never had the column; none at all if the table is gone.
 */
function v1Branches(db: DatabaseSync): { session: string; message: string; part: string } {
  const branch = (table: string, columns: string[], key: string) => {
    const has = columnsOf(db, table);
    if (!has.has('id') || !has.has(key)) return '';
    const list = columns.map((c) => (has.has(c) ? `o.${c}` : `NULL AS ${c}`)).join(', ');
    return `\nUNION ALL\nSELECT ${list} FROM main.${table} o WHERE ${V1_ONLY(`o.${key}`)}`;
  };
  return {
    session: branch('session', SESSION_COLUMNS, 'id'),
    message: branch('message', ['id', 'session_id', 'time_created', 'time_updated', 'data'], 'session_id'),
    part: branch('part', ['id', 'message_id', 'session_id', 'time_created', 'time_updated', 'data'], 'session_id')
  };
}

/** Give this connection the 1.x tables, if its database is 2.x. Returns whether it was. */
export function installV2Views(db: DatabaseSync): boolean {
  if (!isV2Schema(db)) return false;
  const v1 = v1Branches(db);
  db.exec(`${SESSION_VIEW}${v1.session};\n${MESSAGE_VIEW}${v1.message};\n${PART_VIEW}${v1.part};`);
  return true;
}
