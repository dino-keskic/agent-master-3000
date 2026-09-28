import { SubagentSession } from '../../shared/sessions/types.js';
import { modelInfoForSession, parseSessionModel } from './models.js';
import { readDb, toIso } from './db.js';
import { lastTurnSnapshot } from './sessionMetrics.js';

export function listChildSessionIds(parentId: string): string[] {
  if (!parentId) return [];
  const db = readDb();
  if (!db) return [];
  try {
    const rows = db.prepare(`
      WITH RECURSIVE subagents(id) AS (
        SELECT id FROM session WHERE parent_id = ?
        UNION ALL
        SELECT s.id FROM session s JOIN subagents sub ON s.parent_id = sub.id
      )
      SELECT id FROM subagents
    `).all(parentId) as { id: string }[];
    return rows.map((row) => row.id).filter(Boolean);
  } catch (e) {
    console.warn('[OpenCode DB] list child sessions failed:', e);
    return [];
  }
}

function sessionModelLabel(raw: unknown): string | undefined {
  const parsed = parseSessionModel(raw);
  if (parsed.provider && parsed.id) return `${parsed.provider}/${parsed.id}`;
  return parsed.id;
}

function sortSubagentTree(nodes: SubagentSession[]): void {
  nodes.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '') || a.sessionId.localeCompare(b.sessionId));
  for (const node of nodes) sortSubagentTree(node.children);
}

/**
 * Own cost/tokens plus every nested descendant, written to `treeCost` /
 * `treeTokenCount`. The own figures stay put: each child is a row of its own
 * right under its parent, so printing the sum on the parent too counts it twice.
 */
function rollupSubagentTree(node: SubagentSession): { cost: number; tokens: number } {
  let cost = node.cost || 0;
  let tokens = node.tokenCount || 0;
  for (const child of node.children) {
    const extra = rollupSubagentTree(child);
    cost += extra.cost;
    tokens += extra.tokens;
  }
  if (node.children.length > 0) {
    node.treeCost = cost > 0 ? cost : undefined;
    node.treeTokenCount = tokens > 0 ? tokens : undefined;
  }
  return { cost, tokens };
}

/**
 * Direct child sessions of `parentId`, each with nested `children`.
 * One query for the whole descendant set; the tree is assembled in memory.
 */
export function listChildSessions(parentId: string): SubagentSession[] {
  if (!parentId) return [];
  const db = readDb();
  if (!db) return [];
  try {
    const rows = db.prepare(`
      WITH RECURSIVE descendants(id) AS (
        SELECT id FROM session WHERE parent_id = ?
        UNION ALL
        SELECT s.id FROM session s JOIN descendants d ON s.parent_id = d.id
      )
      SELECT s.id, s.parent_id, s.title, s.agent, s.model, s.cost,
             s.time_created, s.time_updated,
             s.tokens_input, s.tokens_output, s.tokens_reasoning,
             s.tokens_cache_read, s.tokens_cache_write
      FROM session s
      JOIN descendants d ON d.id = s.id
    `).all(parentId) as {
      id: string;
      parent_id: string | null;
      title: string;
      agent: string | null;
      model: unknown;
      cost: number | null;
      time_created: number | null;
      time_updated: number | null;
      tokens_input: number | null;
      tokens_output: number | null;
      tokens_reasoning: number | null;
      tokens_cache_read: number | null;
      tokens_cache_write: number | null;
    }[];
    if (rows.length === 0) return [];

    // The model a subagent last answered with is the one its context is
    // measured against; the session column is only what it was opened with.
    const turns = lastTurnSnapshot(db, rows.map((row) => row.id));

    const nodes = new Map<string, SubagentSession>();
    for (const row of rows) {
      if (!row.id || !row.parent_id) continue;
      // Cached input counted, as everywhere else the board counts tokens.
      const ownTokens = (Number(row.tokens_input) || 0)
        + (Number(row.tokens_output) || 0)
        + (Number(row.tokens_reasoning) || 0)
        + (Number(row.tokens_cache_read) || 0)
        + (Number(row.tokens_cache_write) || 0);
      const ownCost = Number(row.cost) || 0;
      const turn = turns.get(row.id);
      const model = turn?.model || sessionModelLabel(row.model);
      nodes.set(row.id, {
        sessionId: row.id,
        parentId: row.parent_id,
        title: row.title || 'Untitled session',
        agent: row.agent || undefined,
        model,
        cost: ownCost > 0 ? ownCost : undefined,
        tokenCount: ownTokens > 0 ? ownTokens : undefined,
        contextTokens: turn?.contextTokens,
        contextLimit: modelInfoForSession(turn?.model || row.model)?.contextLimit,
        createdAt: toIso(row.time_created) || undefined,
        updatedAt: toIso(row.time_updated) || undefined,
        children: []
      });
    }

    const roots: SubagentSession[] = [];
    for (const node of nodes.values()) {
      const parent = nodes.get(node.parentId);
      if (parent) parent.children.push(node);
      else if (node.parentId === parentId) roots.push(node);
    }

    for (const root of roots) rollupSubagentTree(root);
    sortSubagentTree(roots);
    return roots;
  } catch (e) {
    console.warn('[OpenCode DB] list child session tree failed:', e);
    return [];
  }
}

export function findRootSessionId(sessionId: string): string | undefined {
  if (!sessionId) return undefined;
  const db = readDb();
  if (!db) return undefined;
  try {
    const row = db.prepare(`
      WITH RECURSIVE ancestors(id, parent_id) AS (
        SELECT id, parent_id FROM session WHERE id = ?
        UNION ALL
        SELECT s.id, s.parent_id FROM session s JOIN ancestors a ON s.id = a.parent_id
      )
      SELECT id FROM ancestors WHERE parent_id IS NULL LIMIT 1
    `).get(sessionId) as { id: string } | undefined;
    return row?.id || sessionId;
  } catch {
    return sessionId;
  }
}
