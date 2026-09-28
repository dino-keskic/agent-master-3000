import { DatabaseSync } from 'node:sqlite';
import { contextTokensFromUsage } from '../../shared/sessions/cost.js';
import { turnAttributionFromMessage } from '../../shared/turns/attribution.js';

/** How far back to walk past empty-token trailing assistant messages. */
const LAST_CONTEXT_MESSAGES = 16;

function contextFromMessageData(raw: string): number {
  try {
    const data = JSON.parse(raw);
    if (data?.role && data.role !== 'assistant') return 0;
    const tokens = data?.tokens;
    if (!tokens) return 0;
    return contextTokensFromUsage({
      total: tokens.total,
      input: tokens.input,
      output: tokens.output,
      reasoning: tokens.reasoning,
      cacheRead: tokens.cache?.read,
      cacheWrite: tokens.cache?.write
    });
  } catch {
    return 0;
  }
}

interface LastTurn {
  contextTokens: number;
  model?: string;
}

/**
 * Last-turn occupancy and the model that produced it. Walks the
 * (session_id, time_created) index — json_extract over the whole message
 * table on a multi-GB OpenCode DB is what delayed cost/context.
 */
export function lastTurnSnapshot(db: DatabaseSync, ids: string[]): Map<string, LastTurn> {
  const map = new Map<string, LastTurn>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return map;
  try {
    const stmt = db.prepare(
      `SELECT data FROM message WHERE session_id = ? ORDER BY time_created DESC, id DESC LIMIT ?`
    );
    for (const id of unique) {
      const rows = stmt.all(id, LAST_CONTEXT_MESSAGES) as { data: string }[];
      for (const row of rows) {
        const ctx = contextFromMessageData(row.data);
        if (ctx <= 0) continue;
        let model: string | undefined;
        try {
          const attr = turnAttributionFromMessage(JSON.parse(row.data));
          model = attr.model;
        } catch { /* ignore */ }
        map.set(id, { contextTokens: ctx, model });
        break;
      }
    }
  } catch (e) {
    console.warn('[OpenCode DB] last context tokens failed:', e);
  }
  return map;
}

/** Messages dated before the session row — the conversation a fork copied. */
export function inheritedSessionCosts(db: DatabaseSync, ids: string[]): Map<string, number> {
  const map = new Map<string, number>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return map;
  try {
    const placeholders = unique.map(() => '?').join(', ');
    const rows = db.prepare(`
      SELECT m.session_id AS id,
             COALESCE(SUM(CAST(json_extract(m.data, '$.cost') AS REAL)), 0) AS inherited
      FROM message m
      JOIN session s ON s.id = m.session_id
      WHERE m.session_id IN (${placeholders})
        AND m.time_created < s.time_created
      GROUP BY m.session_id
    `).all(...unique) as { id: string; inherited: number }[];
    for (const row of rows) map.set(row.id, Number(row.inherited) || 0);
  } catch (e) {
    console.warn('[OpenCode DB] inherited session costs failed:', e);
  }
  return map;
}

export function sessionTreeExtras(
  db: DatabaseSync,
  ids: string[]
): Map<string, { cost: number; tokenCount: number; childCount: number }> {
  const map = new Map<string, { cost: number; tokenCount: number; childCount: number }>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return map;
  try {
    const placeholders = unique.map(() => '?').join(', ');
    const rows = db.prepare(`
      WITH RECURSIVE subagents(id, parent_id, root_id, cost, tokens) AS (
        SELECT id, parent_id, parent_id AS root_id,
               cost,
               (COALESCE(tokens_input, 0) + COALESCE(tokens_output, 0) + COALESCE(tokens_reasoning, 0)
                + COALESCE(tokens_cache_read, 0) + COALESCE(tokens_cache_write, 0)) AS tokens
        FROM session
        WHERE parent_id IN (${placeholders})
        UNION ALL
        SELECT s.id, s.parent_id, sub.root_id,
               s.cost,
               (COALESCE(s.tokens_input, 0) + COALESCE(s.tokens_output, 0) + COALESCE(s.tokens_reasoning, 0)
                + COALESCE(s.tokens_cache_read, 0) + COALESCE(s.tokens_cache_write, 0)) AS tokens
        FROM session s
        JOIN subagents sub ON s.parent_id = sub.id
      )
      SELECT root_id AS root,
             COALESCE(SUM(cost), 0) AS cost,
             COALESCE(SUM(tokens), 0) AS tokens,
             COUNT(*) AS n
      FROM subagents
      GROUP BY root_id
    `).all(...unique) as { root: string; cost: number; tokens: number; n: number }[];
    for (const row of rows) {
      map.set(row.root, {
        cost: Number(row.cost) || 0,
        tokenCount: Number(row.tokens) || 0,
        childCount: Number(row.n) || 0
      });
    }
  } catch (e) {
    console.warn('[OpenCode DB] session tree totals failed:', e);
  }
  return map;
}
