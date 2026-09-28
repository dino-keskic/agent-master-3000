import path from 'path';
import { compareSessionOrder } from '../../shared/sessions/list.js';
import { AcpSessionListResponse, AcpSessionSummary } from '../../shared/sessions/types.js';
import { ChangeSummary } from '../../shared/types.js';
import { modelInfoForSession, parseSessionModel } from './models.js';
import { directoryExists, readDb, toIso } from './db.js';
import { CwdProbe, findProject, matchProjectName, probeDirectories, worktreeLabel } from './projects.js';
import { inheritedSessionCosts, lastTurnSnapshot, sessionTreeExtras } from './sessionMetrics.js';

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

/** A raw `session` row. Its columns are read defensively below, not typed here. */
type SessionRow = Record<string, any>;

type SessionDb = NonNullable<ReturnType<typeof readDb>>;

function toSummary(
  row: SessionRow,
  projectRoot?: string,
  probe?: { exists: boolean; dirty: boolean },
  projectName?: string,
  extras?: {
    contextTokens?: number;
    contextModel?: string;
    treeCost?: number;
    treeTokens?: number;
    childCount?: number;
    inheritedCost?: number;
  }
): AcpSessionSummary {
  const files = Number(row.summary_files) || 0;
  const additions = Number(row.summary_additions) || 0;
  const deletions = Number(row.summary_deletions) || 0;
  const changeSummary: ChangeSummary | undefined =
    files > 0 || additions > 0 || deletions > 0
      ? { files, additions, deletions }
      : undefined;
  const cwd = row.directory || '';
  const label = worktreeLabel(cwd, projectRoot);
  const parsedModel = parseSessionModel(row.model);
  const lastModel = extras?.contextModel || (parsedModel.id
    ? (parsedModel.provider ? `${parsedModel.provider}/${parsedModel.id}` : parsedModel.id)
    : undefined);
  const modelInfo = modelInfoForSession(extras?.contextModel || row.model);
  // Cached input included, the same as everywhere else the board counts tokens:
  // it is billed and it is what the turns processed. Cost still comes off the
  // session's own `cost` column — these columns count the cache every turn and
  // are no basis for pricing.
  const tokenCount = (Number(row.tokens_input) || 0) + (Number(row.tokens_output) || 0) + (Number(row.tokens_reasoning) || 0)
    + (Number(row.tokens_cache_read) || 0) + (Number(row.tokens_cache_write) || 0)
    || Number(row.token_count) || 0;
  const treeCost = extras?.treeCost || 0;
  const treeTokens = extras?.treeTokens || 0;
  const childCount = extras?.childCount || 0;
  const cost = (Number(row.cost) || 0) + treeCost;

  return {
    sessionId: row.id,
    title: row.title || 'Untitled session',
    cwd,
    createdAt: toIso(row.time_created),
    updatedAt: toIso(row.time_updated),
    agent: row.agent || undefined,
    model: lastModel,
    changeSummary,
    isWorktree: !!label,
    worktreeLabel: label,
    cwdExists: probe?.exists,
    // Main-repo dirtiness is shared by every session in that checkout and is not
    // a per-session signal. Only tag worktrees, where the folder is the unit of work.
    cwdDirty: !!label && probe?.dirty,
    projectName,
    tokenCount: tokenCount + treeTokens,
    cost: cost > 0 ? cost : undefined,
    inheritedCost: extras?.inheritedCost && extras.inheritedCost > 0 ? extras.inheritedCost : undefined,
    subagentCount: childCount > 0 ? childCount : undefined,
    contextTokens: extras?.contextTokens,
    contextLimit: modelInfo?.contextLimit
  };
}

const SESSION_COLUMNS = `id, title, directory, time_created, time_updated, agent, model, cost, summary_files, summary_additions, summary_deletions, project_id,
              tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write`;

const ROOT_SESSION = `(parent_id IS NULL AND IFNULL(title, '') NOT LIKE '%subagent%')`;

interface BoardProject {
  name: string;
  path: string;
}

/**
 * Which rows belong to the board's projects.
 *
 * OpenCode keys a session by its own project id where it knows one and by
 * directory where it does not — a worktree the board opened before OpenCode
 * ever saw it. Both spellings have to be asked for, or the list comes back
 * missing exactly the sessions the user just made.
 */
function sessionQuery(
  db: SessionDb,
  boardProjects: BoardProject[],
  query: string | undefined
): { where: string; params: string[]; worktreeByProjectId: Map<string, string> } {
  const clauses: string[] = ['time_archived IS NULL', ROOT_SESSION];
  const params: string[] = [];
  const worktreeByProjectId = new Map<string, string>();
  const pathFallbacks: string[] = [];

  for (const board of boardProjects) {
    const found = findProject(db, board.path);
    if (found) worktreeByProjectId.set(found.id, found.worktree);
    else pathFallbacks.push(board.path);
  }

  const scopeParts: string[] = [];
  if (worktreeByProjectId.size > 0) {
    scopeParts.push(`project_id IN (${[...worktreeByProjectId.keys()].map(() => '?').join(', ')})`);
    params.push(...worktreeByProjectId.keys());
  }
  for (const folder of pathFallbacks) {
    scopeParts.push('(directory = ? OR directory LIKE ? OR directory LIKE ?)');
    params.push(folder, `${folder}.worktrees/%`, `${folder}/%`);
  }
  if (scopeParts.length > 0) clauses.push(`(${scopeParts.join(' OR ')})`);

  if (query && query.trim()) {
    clauses.push('(title LIKE ? OR directory LIKE ?)');
    const like = `%${query.trim()}%`;
    params.push(like, like);
  }

  return { where: clauses.join(' AND '), params, worktreeByProjectId };
}

/** Rows whose folder is still on disk, unless the caller wants the removed ones too. */
function reachableRows(
  rows: SessionRow[],
  includeRemoved: boolean
): { rows: SessionRow[]; existsByDir: Map<string, boolean> } {
  const existsByDir = new Map<string, boolean>();
  for (const row of rows) {
    const dir = row.directory || '';
    if (!existsByDir.has(dir)) existsByDir.set(dir, directoryExists(dir));
  }
  return {
    rows: rows.filter((row) => includeRemoved || existsByDir.get(row.directory || '')),
    existsByDir
  };
}

type Summarize = (row: SessionRow, probe?: CwdProbe, extras?: SummaryExtras) => AcpSessionSummary;

interface SummaryExtras {
  contextTokens?: number;
  contextModel?: string;
  treeCost?: number;
  treeTokens?: number;
  childCount?: number;
}

/** Naming a row's project, which takes OpenCode's answer over the path match. */
function rowSummarizer(boardProjects: BoardProject[], worktreeByProjectId: Map<string, string>): Summarize {
  return (row, probe, extras) => {
    const ocRoot = (row.project_id && worktreeByProjectId.get(row.project_id)) || undefined;
    const projectRoot = ocRoot || boardProjects.find((p) => matchProjectName(row.directory || '', [p]))?.path;
    const projectName =
      (ocRoot && matchProjectName(ocRoot, boardProjects))
      || matchProjectName(row.directory || '', boardProjects)
      || (projectRoot ? path.basename(projectRoot) : undefined);
    return toSummary(row, projectRoot, probe, projectName, extras);
  };
}

/** Git status and rolled-up costs, for the one page being returned. */
async function enrichPage(
  db: SessionDb,
  pageRows: SessionRow[],
  summarize: Summarize
): Promise<AcpSessionSummary[]> {
  const probes = await probeDirectories(pageRows.map((row) => row.directory || ''));
  const ids = pageRows.map((row) => row.id);
  const treeById = sessionTreeExtras(db, ids);
  const turnById = lastTurnSnapshot(db, ids);

  return pageRows
    .map((row) => {
      const tree = treeById.get(row.id);
      const turn = turnById.get(row.id);
      return summarize(row, probes.get(row.directory || ''), {
        contextTokens: turn?.contextTokens,
        contextModel: turn?.model,
        treeCost: tree?.cost,
        treeTokens: tree?.tokenCount,
        childCount: tree?.childCount
      });
    })
    .sort(compareSessionOrder);
}

const UNTITLED_PREFIX = 'New session - ';

export async function listOpenCodeSessions(options: {
  cwd?: string;
  /** Board projects to include. When set, sessions from every path are merged. */
  projects?: BoardProject[];
  query?: string;
  includeUntitled?: boolean;
  /** When false (default), hide sessions whose cwd/worktree no longer exists. */
  includeRemoved?: boolean;
  limit?: number;
}): Promise<AcpSessionListResponse> {
  const empty: AcpSessionListResponse = { sessions: [], total: 0, untitledCount: 0 };
  const db = readDb();
  if (!db) return empty;

  try {
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const boardProjects = options.projects?.length
      ? options.projects
      : options.cwd
        ? [{ name: path.basename(options.cwd), path: options.cwd }]
        : [];
    if (boardProjects.length === 0) return empty;

    const { where, params, worktreeByProjectId } = sessionQuery(db, boardProjects, options.query);
    const all = db.prepare(`SELECT ${SESSION_COLUMNS} FROM session WHERE ${where}`).all(...params) as SessionRow[];

    const { rows: reachable, existsByDir } = reachableRows(all, options.includeRemoved === true);
    const untitledCount = reachable.filter((row) => String(row.title || '').startsWith(UNTITLED_PREFIX)).length;
    const live = options.includeUntitled
      ? reachable
      : reachable.filter((row) => !String(row.title || '').startsWith(UNTITLED_PREFIX));

    // Rank the cheap rows first, then git-status and roll up costs only for
    // the page we return. The OpenCode DB can be many GB; probing every
    // worktree and json_extracting every message is what 500'd the import list.
    const summarize = rowSummarizer(boardProjects, worktreeByProjectId);
    const rowById = new Map<string, SessionRow>(live.map((row) => [row.id, row]));
    const ranked = live
      .map((row) => summarize(row, { exists: !!existsByDir.get(row.directory || ''), dirty: false, dirtyFiles: [] }))
      .sort(compareSessionOrder);
    const pageRows = ranked
      .slice(0, limit)
      .map((summary) => rowById.get(summary.sessionId))
      .filter((row): row is SessionRow => !!row);

    return { sessions: await enrichPage(db, pageRows, summarize), total: ranked.length, untitledCount };
  } catch (e) {
    console.warn('[OpenCode DB] list sessions failed:', e);
    return empty;
  }
}

export function getSessionChangeSummary(sessionId: string): ChangeSummary | undefined {
  const db = readDb();
  if (!db) return undefined;
  try {
    const row = db.prepare(
      'SELECT summary_files, summary_additions, summary_deletions FROM session WHERE id = ?'
    ).get(sessionId) as any;
    if (!row) return undefined;
    const files = Number(row.summary_files) || 0;
    const additions = Number(row.summary_additions) || 0;
    const deletions = Number(row.summary_deletions) || 0;
    if (files === 0 && additions === 0 && deletions === 0) return undefined;
    return { files, additions, deletions };
  } catch (e) {
    console.warn('[OpenCode DB] change summary failed:', e);
    return undefined;
  }
}

export function getOpenCodeSessionsById(ids: string[]): Map<string, AcpSessionSummary> {
  const map = new Map<string, AcpSessionSummary>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return map;
  const db = readDb();
  if (!db) return map;
  try {
    const placeholders = unique.map(() => '?').join(', ');
    const rows = db.prepare(
      `SELECT ${SESSION_COLUMNS} FROM session WHERE id IN (${placeholders})`
    ).all(...unique) as any[];
    const existsByDir = new Map<string, boolean>();
    for (const row of rows) {
      const dir = row.directory || '';
      if (!existsByDir.has(dir)) existsByDir.set(dir, directoryExists(dir));
    }
    // Cost lives on the session row and rolls up through the tree. Last-turn
    // context is a separate, cheaper index walk — keep it after cost so a
    // slow message read cannot hide spend that is already on the row.
    // Do not git-status here: hydrate already probed task cwds, and dirty
    // badges only apply to worktrees in overlayLiveStatus.
    const treeById = sessionTreeExtras(db, unique);
    const turnById = lastTurnSnapshot(db, unique);
    const inheritedById = inheritedSessionCosts(db, unique);
    for (const row of rows) {
      const dir = row.directory || '';
      const tree = treeById.get(row.id);
      const turn = turnById.get(row.id);
      map.set(row.id, toSummary(row, undefined, {
        exists: !!existsByDir.get(dir),
        dirty: false
      }, undefined, {
        contextTokens: turn?.contextTokens,
        contextModel: turn?.model,
        treeCost: tree?.cost,
        treeTokens: tree?.tokenCount,
        childCount: tree?.childCount,
        inheritedCost: inheritedById.get(row.id)
      }));
    }
  } catch (e) {
    console.warn('[OpenCode DB] get sessions by id failed:', e);
  }
  return map;
}

export function getOpenCodeSession(sessionId: string): AcpSessionSummary | undefined {
  return getOpenCodeSessionsById([sessionId]).get(sessionId);
}
