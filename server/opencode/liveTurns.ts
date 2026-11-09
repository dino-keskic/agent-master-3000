import { LIVE_TURN_SILENCE_MS, isAbandonedTurn } from '../../shared/turns/abandoned.js';
import { readDb, readDbIsV2 } from './db.js';

/**
 * How long a turn may sit without `time.completed` (thinking, a long test)
 * before we treat leftover `in_progress` parts as abandoned crash debris.
 */
export const LIVE_TURN_WINDOW_MS = 24 * 60 * 60 * 1000;
/** A user message with no assistant reply yet — the turn is about to start. */
const TURN_STARTING_MS = 120_000;
/**
 * When this process started. Every turn our own `opencode acp` child was
 * driving before then died with the previous board; see `isAbandonedTurn`.
 */
export const BOARD_STARTED_AT = Math.floor(performance.timeOrigin);

type SessionRow = {
  id: string;
  parent_id: string | null;
  root_id: string;
  time_updated: number;
};

/**
 * The sessions worth asking about: each root and its subagent tree, minus the
 * branches that have been quiet too long to be live.
 *
 * Dropping those before touching `part` is what keeps this affordable. The
 * queries below read `part` and `message` rows whose `data` columns hold the
 * tool JSON — gigabytes of it across a real database, and `part` is indexed by
 * `session_id` alone, so there is no covering index to read `time_updated`
 * from. Every extra session in the list is another few thousand blob rows off
 * disk, on a four-second timer.
 *
 * `session.time_updated` is on the small session table and is bumped in the
 * same breath as the writes we are looking for. It can trail the last part by a
 * minute or so, so it is no good as the answer — but it is decisive as a
 * filter, because the threshold is the fifteen-minute silence window and
 * nothing that far behind is a turn anybody is still driving. A branch of
 * subagents from last week costs one integer comparison now instead of a scan.
 * The survivors go through exactly the checks they did before.
 */
function liveCandidates(
  db: NonNullable<ReturnType<typeof readDb>>,
  rootIds: string[],
  now: number
): SessionRow[] {
  const placeholders = rootIds.map(() => '?').join(', ');
  const tree = db.prepare(`
    WITH RECURSIVE subagents(id, parent_id, root_id, time_updated) AS (
      SELECT id, parent_id, id AS root_id, time_updated FROM session WHERE id IN (${placeholders})
      UNION ALL
      SELECT s.id, s.parent_id, sub.root_id, s.time_updated FROM session s JOIN subagents sub ON s.parent_id = sub.id
    )
    SELECT id, parent_id, root_id, time_updated FROM subagents
  `).all(...rootIds) as SessionRow[];

  const quietBefore = now - LIVE_TURN_SILENCE_MS;
  return tree.filter((row) => Number(row.time_updated) >= quietBefore);
}

type LastMessage = { sid: string; role: string | null; completed: number | string | null; t: number };

/**
 * The reads below that look at messages and parts, per schema.
 *
 * On OpenCode 2 a message's parts are its `content`, one JSON blob holding
 * every tool's output — hundreds of kilobytes an answer in a long session. The
 * `message` and `part` views rebuild or unpack that blob for every row they
 * touch, and a join or a time window over them touches all of a busy session's
 * rows: that was tens of seconds on a real database, every time a drawer
 * opened. So on 2.x each session is asked about its newest rows only, picked
 * from `(session_id, time_created, id)` before any blob is read:
 *
 * - its newest prompt or answer, for whether a turn is open;
 * - its newest answer, for a running tool. A tool in an older answer is either
 *   behind a newer one that finished (the turn ended) or one that has not
 *   (already live), so nothing older can change the verdict.
 *
 * Sessions still in the 1.x tables a migration left are long finished.
 */
function v2Reads(db: NonNullable<ReturnType<typeof readDb>>) {
  const newest = (types: string) => `SELECT id FROM main.session_message
    WHERE session_id = ? AND type IN (${types}) ORDER BY time_created DESC, id DESC LIMIT 1`;
  const last = db.prepare(`
    SELECT m.session_id AS sid, m.type AS role, m.data ->> '$.time.completed' AS completed, m.time_updated AS t
    FROM main.session_message m WHERE m.id = (${newest(`'user', 'assistant'`)})`);
  const running = db.prepare(`
    SELECT 1 FROM main.session_message m, json_each(m.data, '$.content') c
    WHERE m.id = (${newest(`'assistant'`)}) AND m.time_updated >= ?
      AND lower(coalesce(c.value ->> '$.state.status', '')) IN ('running', 'pending', 'in_progress')
    LIMIT 1`);
  return {
    writes: (ids: string[]) => db.prepare(`SELECT session_id AS sid, MAX(time_updated) AS t
      FROM main.session_message WHERE session_id IN (${ids.map(() => '?').join(', ')}) GROUP BY session_id`)
      .all(...ids) as { sid: string; t: number | null }[],
    lastMessages: (ids: string[]) => ids.flatMap((id) => last.all(id) as LastMessage[]),
    running: (ids: string[], since: number) => ids.filter((id) => running.get(id, since)).map((sid) => ({ sid }))
  };
}

function v1Reads(db: NonNullable<ReturnType<typeof readDb>>) {
  const inSessions = (ids: string[]) => ids.map(() => '?').join(', ');
  return {
    writes: (ids: string[]) => db.prepare(`SELECT session_id AS sid, MAX(time_updated) AS t
      FROM part WHERE session_id IN (${inSessions(ids)}) GROUP BY session_id`)
      .all(...ids) as { sid: string; t: number | null }[],
    lastMessages: (ids: string[]) => db.prepare(
      `SELECT m.session_id AS sid,
              json_extract(m.data, '$.role') AS role,
              json_extract(m.data, '$.time.completed') AS completed,
              m.time_updated AS t
       FROM message m
       INNER JOIN (
         SELECT session_id, MAX(time_created) AS mt
         FROM message
         WHERE session_id IN (${inSessions(ids)})
         GROUP BY session_id
       ) last ON last.session_id = m.session_id AND last.mt = m.time_created`
    ).all(...ids) as LastMessage[],
    running: (ids: string[], since: number) => db.prepare(`SELECT DISTINCT p.session_id AS sid
      FROM part p
      WHERE p.session_id IN (${inSessions(ids)})
        AND p.time_updated >= ?
        AND lower(coalesce(json_extract(p.data, '$.state.status'), '')) IN ('running', 'pending', 'in_progress')`)
      .all(...ids, since) as { sid: string }[]
  };
}

/**
 * When each session was last written to, from either table, and the verdict
 * that follows: a turn nobody is driving any more stops moving this.
 * See `isAbandonedTurn`.
 */
function writeClock(now: number, boardStartedAt: number) {
  const lastWrite = new Map<string, number>();
  return {
    saw(sessionId: string, at: unknown) {
      const t = Number(at);
      if (!Number.isFinite(t)) return;
      if (t > (lastWrite.get(sessionId) ?? 0)) lastWrite.set(sessionId, t);
    },
    /** Nothing written for long enough that no agent can still be working here. */
    abandoned(sessionId: string) {
      return isAbandonedTurn(lastWrite.get(sessionId), now, boardStartedAt);
    }
  };
}

/**
 * Which sessions under these roots are live, and which root each belongs to.
 *
 * The per-session answer is the one the database actually gives; the roots are
 * a fold of it. Both are wanted — a card asks whether *anything* under it is
 * running, the subagent list asks which particular branch is — so the walk is
 * done once and the two views are taken from the same result.
 */
function liveSessions(rootIds: string[], now: number, boardStartedAt: number): { live: Set<string>; rootOf: Map<string, string> } {
  const active = new Set<string>();
  const rootOf = new Map<string, string>();
  const empty = { live: active, rootOf };
  const unique = [...new Set(rootIds.filter(Boolean))];
  if (unique.length === 0) return empty;
  const db = readDb();
  if (!db) return empty;

  try {
    const candidates = liveCandidates(db, unique, now);
    if (candidates.length === 0) return empty;

    for (const row of candidates) rootOf.set(row.id, row.root_id);
    const clock = writeClock(now, boardStartedAt);
    const sessionIds = candidates.map((row) => row.id);
    const since = now - LIVE_TURN_WINDOW_MS;
    const reads = readDbIsV2() ? v2Reads(db) : v1Reads(db);

    for (const row of reads.writes(sessionIds)) clock.saw(row.sid, row.t);

    // The turn OpenCode is actually in: last assistant message has no
    // `time.completed`. That is how thinking/streaming looks — there is no
    // tool `in_progress` status until a tool starts. A 4-day-old leftover
    // bash part must not win over this.
    const lastMessages = reads.lastMessages(sessionIds);

    for (const row of lastMessages) clock.saw(row.sid, row.t);

    const turnEnded = new Set<string>();
    for (const row of lastMessages) {
      if (!rootOf.has(row.sid)) continue;
      const age = now - Number(row.t);
      if (!Number.isFinite(age) || age < 0) continue;
      const role = String(row.role || '').toLowerCase();
      if (role === 'assistant' && row.completed == null && age <= LIVE_TURN_WINDOW_MS) {
        if (!clock.abandoned(row.sid)) active.add(row.sid);
      } else if (role === 'user' && age <= TURN_STARTING_MS) {
        // A prompt sent just before the board went down has nobody to answer it.
        if (!clock.abandoned(row.sid)) active.add(row.sid);
      } else if (role === 'assistant' && row.completed != null) {
        // Cancel and end_turn both stamp completed. Leftover bash parts below
        // must not drag this session back to "running".
        turnEnded.add(row.sid);
      }
    }

    // In-flight tools that started inside the window. Covers a subagent that
    // wrote a running tool part before any assistant message exists, and a
    // bash that has been going for minutes.
    const liveParts = reads.running(sessionIds, since);

    for (const part of liveParts) {
      if (turnEnded.has(part.sid)) continue;
      if (clock.abandoned(part.sid)) continue;
      if (rootOf.has(part.sid)) active.add(part.sid);
    }
  } catch (e) {
    console.warn('[OpenCode DB] active session probe failed:', e);
  }
  return { live: active, rootOf };
}

/**
 * Sessions that currently have a live OpenCode turn — each subagent in its own
 * right, not folded into the tree it hangs off.
 */
export function activeSessionIds(rootIds: string[], now = Date.now(), boardStartedAt = BOARD_STARTED_AT): Set<string> {
  return liveSessions(rootIds, now, boardStartedAt).live;
}

/** Root sessions that currently have a live OpenCode turn (parent or subagent). */
export function activeRootSessionIds(rootIds: string[], now = Date.now(), boardStartedAt = BOARD_STARTED_AT): Set<string> {
  const { live, rootOf } = liveSessions(rootIds, now, boardStartedAt);
  const roots = new Set<string>();
  for (const sessionId of live) {
    const root = rootOf.get(sessionId);
    if (root) roots.add(root);
  }
  return roots;
}
