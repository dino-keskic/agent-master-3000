import { DatabaseSync } from 'node:sqlite';

/**
 * Which child session each subagent tool call in a transcript handed its work
 * to. This is transcript attribution, not enumeration — `subagents.ts` is what
 * lists and rolls up the children themselves.
 */

interface ChildSessionRow {
  id: string;
  title: string;
  agent?: string;
  createdAt: number;
}

/** Direct children of `parentId`, oldest first — the pool a `task` call resolves against. */
function directChildRows(db: DatabaseSync, parentId: string): ChildSessionRow[] {
  try {
    const rows = db.prepare(
      `SELECT id, title, agent, time_created FROM session WHERE parent_id = ? ORDER BY time_created, id`
    ).all(parentId) as { id: string; title: string | null; agent: string | null; time_created: number | null }[];
    return rows.map((row) => ({
      id: row.id,
      title: row.title || '',
      agent: row.agent || undefined,
      createdAt: Number(row.time_created) || 0
    }));
  } catch {
    return [];
  }
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

export interface SubagentLink {
  subagentSessionId?: string;
  subagentName?: string;
}

/**
 * OpenCode stamps the id onto the part when it has one
 * (`state.metadata.sessionID`), and that is the only answer worth trusting.
 * Parts written before it did carry nothing, so fall back to the child
 * sessions themselves: one is created per call, at the moment of the call,
 * with the caller's `description` as its title. Match on that title, then on
 * the closest unclaimed child by creation time. `claimed` is what stops three
 * `task` calls in one transcript from all pointing at the same session.
 */
function resolveSubagentLink(
  part: any,
  timestamp: number,
  children: ChildSessionRow[],
  claimed: Set<string>
): SubagentLink {
  const state = (part?.state && typeof part.state === 'object' ? part.state : {}) as Record<string, any>;
  const input = (state.input && typeof state.input === 'object' ? state.input : {}) as Record<string, unknown>;
  const requested = firstString(input.subagent_type, input.subagentType, input.agent, input.name);
  const declared = firstString(state.metadata?.sessionID, state.metadata?.sessionId, state.metadata?.session_id);

  if (declared) {
    claimed.add(declared);
    return { subagentSessionId: declared, subagentName: requested || children.find((c) => c.id === declared)?.agent };
  }

  const free = children.filter((child) => !claimed.has(child.id));
  if (free.length === 0) return { subagentName: requested };

  const description = firstString(input.description, part?.title);
  const byTitle = description ? free.find((child) => child.title === description) : undefined;
  const sameAgent = requested ? free.filter((child) => child.agent === requested) : [];
  const pool = sameAgent.length > 0 ? sameAgent : free;
  const match = byTitle || pool.reduce((best, child) =>
    Math.abs(child.createdAt - timestamp) < Math.abs(best.createdAt - timestamp) ? child : best
  );

  claimed.add(match.id);
  return { subagentSessionId: match.id, subagentName: requested || match.agent };
}

export type SubagentResolver = (part: any, timestamp: number) => SubagentLink;

/**
 * A resolver for one transcript. The children are read on the first subagent
 * tool call and not before: a poll over a session full of `read` calls should
 * pay nothing for a feature it never uses.
 */
export function subagentResolver(db: DatabaseSync, sessionId: string): SubagentResolver {
  let children: ChildSessionRow[] | undefined;
  const claimed = new Set<string>();
  return (part, timestamp) => resolveSubagentLink(part, timestamp, (children ??= directChildRows(db, sessionId)), claimed);
}
