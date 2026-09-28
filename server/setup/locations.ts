import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import {
  BoardConfig,
  Locations,
  binCandidates,
  opencodeChildEnv,
  opencodeConfigDirs,
  opencodeConfigFiles,
  opencodeDataDir,
  opencodeEnvFor,
  pickChannelDb,
  resolveLocations
} from '../../shared/setup/locations.js';
import {
  LOCATION_INFO,
  LOCATION_KEYS,
  LocationCheck,
  LocationKey,
  LocationStatus,
  PathFacts,
  SetupPatch,
  SetupReport,
  assessLocation,
  envKeyProblem,
  normalizePathInput
} from '../../shared/setup/report.js';
import { boardConfigPath, dataDir, pathContext } from '../app/appPaths.js';
import { readBoardConfig, writeBoardConfig } from './configFile.js';

/**
 * Where things are, for this process: the board's data folder and the pieces
 * of OpenCode it drives, as the setup file, the environment and a look at the
 * disk decide them (`shared/setup/locations.ts` holds the rules).
 *
 * Everything that finds OpenCode goes through here — the agent's executable,
 * the environment it starts with, the sessions database, the model list, the
 * config folders — so a location changed in the settings panel reaches all of
 * them at once. Also the setup screens' server side: the report, checking one
 * path, and saving a change.
 */

/** The data folder this process started with. Moving it needs a restart, so this is the one in use until then. */
export const BOOT_DATA_DIR = dataDir();

/**
 * How long a resolution is trusted. The sessions DB path is asked for on every
 * poll; a search of PATH and a stat of the setup file each time would be
 * waste, but OpenCode installed while the board runs should still be found.
 */
const CACHE_MS = 5_000;

/** The variables a resolution depends on. A test changing one gets a fresh answer at once. */
const ENV_INPUTS = [
  'AGENT_MASTER_CONFIG',
  'AGENT_MASTER_DATA_DIR',
  'OPENCODE_BIN',
  'OPENCODE_CONFIG_DIR',
  'OPENCODE_CONFIG',
  'OPENCODE_DB',
  'OPENCODE_MODELS_PATH',
  'OPENCODE_MODELS',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'HOME',
  'PATH'
];

let cache: { key: string; at: number; config: BoardConfig; locations: Locations } | null = null;

function envKey(): string {
  return ENV_INPUTS.map((name) => process.env[name] ?? '').join('\0');
}

function isExecutableFile(file: string): boolean {
  try {
    if (!fs.statSync(file).isFile()) return false;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Every OpenCode on the search path and in the usual install folders, first the one that would run. */
export function foundBins(): string[] {
  const ctx = pathContext();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const file of binCandidates(process.env, ctx.home, ctx.platform)) {
    if (!isExecutableFile(file)) continue;
    let real = file;
    try {
      real = fs.realpathSync(file);
    } catch {
      /* keep the link */
    }
    if (seen.has(real)) continue;
    seen.add(real);
    out.push(file);
  }
  return out;
}

function channelDb(config: BoardConfig): string | undefined {
  const dir = opencodeDataDir(opencodeEnvFor(config, process.env), pathContext().home);
  if (fs.existsSync(path.join(dir, 'opencode.db'))) return undefined;
  try {
    const entries = fs.readdirSync(dir).map((name) => ({ name, mtimeMs: fileMtime(path.join(dir, name)) }));
    const picked = pickChannelDb(entries);
    return picked ? path.join(dir, picked) : undefined;
  } catch {
    return undefined;
  }
}

function fileMtime(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function resolveNow(): { config: BoardConfig; locations: Locations } {
  const config = readBoardConfig(boardConfigPath());
  const ctx = pathContext();
  const binDecided = !!process.env.OPENCODE_BIN || !!config.opencodeBin;
  const dbDecided = !!process.env.OPENCODE_DB || !!config.opencodeDb;
  const locations = resolveLocations(config, ctx, {
    bin: binDecided ? undefined : foundBins()[0],
    channelDb: dbDecided ? undefined : channelDb(config)
  });
  return { config, locations };
}

function current(): { config: BoardConfig; locations: Locations } {
  const key = envKey();
  const now = Date.now();
  if (!cache || cache.key !== key || now - cache.at > CACHE_MS) {
    cache = { key, at: now, ...resolveNow() };
  }
  return cache;
}

/** Forget the last resolution — after the setup file changes. */
export function invalidateLocations(): void {
  cache = null;
}

export function locations(): Locations {
  return current().locations;
}

export function boardConfig(): BoardConfig {
  return current().config;
}

/** The `opencode` executable to run. */
export function opencodeBin(): string {
  return locations().opencodeBin.value;
}

/** OpenCode's sessions database. */
export function opencodeDbPath(): string {
  return locations().opencodeDb.value;
}

/** OpenCode's cached model catalog. */
export function opencodeModelsPath(): string {
  return locations().opencodeModels.value;
}

/** The config files OpenCode merges, in order; the model catalog reads context limits out of them. */
export function opencodeConfigFilePaths(): string[] {
  const { config, locations: locs } = current();
  return opencodeConfigFiles(locs, config, pathContext());
}

/** The folders OpenCode loads agents, commands and skills from. */
export function opencodeGlobalConfigDirs(): string[] {
  const { config, locations: locs } = current();
  return opencodeConfigDirs(locs, config, pathContext());
}

/** The environment every OpenCode the board starts gets, before the tool policy goes on top. */
export function childBaseEnv(): NodeJS.ProcessEnv {
  const { config, locations: locs } = current();
  return { ...process.env, ...opencodeChildEnv(config, locs) };
}

/** What the agent is started with. A change to it means the running agent is out of date. */
function agentSignature(): string {
  const { config, locations: locs } = current();
  return JSON.stringify([locs.opencodeBin.value, opencodeChildEnv(config, locs)]);
}

// --- looking at a path ---

function nearestExisting(dir: string): string | null {
  let at = dir;
  while (!fs.existsSync(at)) {
    const up = path.dirname(at);
    if (up === at) return null;
    at = up;
  }
  return at;
}

function canWrite(target: string): boolean {
  try {
    fs.accessSync(target, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Whether `file` is an SQLite database with OpenCode's `session` table. Read-only, and never created. */
function looksLikeOpencodeDb(file: string): boolean {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session'`).get();
  } catch {
    return false;
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}

/** A bare `opencode`, as the environment may name it, is wherever PATH finds it. */
function onPath(value: string): string {
  if (path.isAbsolute(value) || value.includes('/') || value.includes('\\')) return path.resolve(value);
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const file = path.join(dir, value);
    if (isExecutableFile(file)) return file;
  }
  return value;
}

export function pathFacts(key: LocationKey, value: string): PathFacts {
  const target = key === 'opencodeBin' ? onPath(value) : value;
  if (!path.isAbsolute(target)) return { exists: false };
  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    if (key !== 'dataDir') return { exists: false };
    const parent = nearestExisting(path.dirname(target));
    return { exists: false, creatable: !!parent && fs.statSync(parent).isDirectory() && canWrite(parent) };
  }
  const kind = stat.isFile() ? 'file' : stat.isDirectory() ? 'dir' : 'other';
  const facts: PathFacts = { exists: true, kind };
  if (kind !== LOCATION_INFO[key].kind) return facts;
  if (key === 'opencodeBin') facts.executable = isExecutableFile(target);
  if (key === 'dataDir') {
    facts.writable = canWrite(target);
    facts.hasBoard = fs.existsSync(path.join(target, 'board_state.json'));
  }
  if (key === 'opencodeDb') facts.looksLikeDb = looksLikeOpencodeDb(target);
  return facts;
}

function status(key: LocationKey, locs: Locations): LocationStatus {
  const { value, source, envVar } = locs[key];
  const facts = pathFacts(key, value);
  return { key, value, source, envVar, ...assessLocation(key, facts), hasBoard: facts.hasBoard };
}

export function setupReport(): SetupReport {
  const { config, locations: locs } = current();
  const report: SetupReport = {
    configFile: boardConfigPath() || '',
    locations: LOCATION_KEYS.map((key) => status(key, locs)),
    opencodeEnv: config.opencodeEnv || {},
    binCandidates: foundBins(),
    dataDirInUse: BOOT_DATA_DIR
  };
  if (config.moveDataFrom && locs.dataDir.value !== config.moveDataFrom) {
    report.pendingMove = { from: config.moveDataFrom, to: locs.dataDir.value };
  }
  if (process.env.BOARD_STATE_FILE) report.stateFileOverride = path.resolve(process.env.BOARD_STATE_FILE);
  return report;
}

/** One typed path, cleaned up and judged, before anything is saved. */
export function checkLocation(key: LocationKey, raw: string): LocationCheck {
  const value = normalizePathInput(raw, pathContext().home);
  if (!value) return { value: raw, severity: 'error', note: 'Use a full path, starting with / or ~.' };
  const facts = pathFacts(key, value);
  return { value, ...assessLocation(key, facts), hasBoard: facts.hasBoard };
}

export type SaveOutcome =
  | { ok: true; agentChanged: boolean }
  | { ok: false; status: number; error: string; needsDataMove?: boolean };

/**
 * Apply `patch` to the setup file. Refuses — writing nothing — when a path is
 * wrong for its job, when the environment decides a location (the file could
 * not change it), or when the data folder moves to one with no board and the
 * patch does not say whether to bring this one along.
 */
export function saveSetup(patch: SetupPatch): SaveOutcome {
  const file = boardConfigPath();
  if (!file) return { ok: false, status: 409, error: 'This board has no setup file.' };
  const before = agentSignature();
  const next: BoardConfig = { ...readBoardConfig(file) };
  const locs = locations();

  for (const key of LOCATION_KEYS) {
    if (!patch.locations || !(key in patch.locations)) continue;
    const raw = patch.locations[key];
    if (locs[key].source === 'env') {
      return { ok: false, status: 409, error: `${LOCATION_INFO[key].title} is set by $${locs[key].envVar}; change it there.` };
    }
    if (raw === null || raw === undefined || raw === '') {
      delete next[key];
      continue;
    }
    const check = checkLocation(key, raw);
    if (check.severity === 'error') return { ok: false, status: 400, error: `${LOCATION_INFO[key].title}: ${check.note}` };
    next[key] = check.value;
  }

  if (patch.opencodeEnv) {
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(patch.opencodeEnv)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return { ok: false, status: 400, error: `${name} is not a variable name.` };
      const problem = envKeyProblem(name);
      if (problem) return { ok: false, status: 400, error: problem };
      env[name] = String(value);
    }
    if (Object.keys(env).length > 0) next.opencodeEnv = env;
    else delete next.opencodeEnv;
  }

  const moved = planDataMove(next, patch);
  if (!moved.ok) return moved;

  writeBoardConfig(file, next);
  invalidateLocations();
  return { ok: true, agentChanged: agentSignature() !== before };
}

/**
 * The data folder only changes on the next start. When it is going somewhere
 * without a board, the user says whether this board comes along; the copy
 * itself happens at startup (`server/setup/dataMove.ts`), before anything opens it.
 */
function planDataMove(next: BoardConfig, patch: SetupPatch): { ok: true } | { ok: false; status: number; error: string; needsDataMove: true } {
  const target = resolveLocations(next, pathContext()).dataDir.value;
  if (process.env.BOARD_STATE_FILE || path.resolve(target) === path.resolve(BOOT_DATA_DIR)) {
    delete next.moveDataFrom;
    return { ok: true };
  }
  const hasBoardHere = fs.existsSync(path.join(BOOT_DATA_DIR, 'board_state.json'));
  const hasBoardThere = fs.existsSync(path.join(target, 'board_state.json'));
  if (hasBoardThere || !hasBoardHere) {
    delete next.moveDataFrom;
    return { ok: true };
  }
  if (patch.dataMove === 'move') next.moveDataFrom = BOOT_DATA_DIR;
  else if (patch.dataMove === 'fresh') delete next.moveDataFrom;
  else if (!next.moveDataFrom) {
    return { ok: false, status: 400, error: 'Say whether to bring this board to the new folder or start empty.', needsDataMove: true };
  }
  return { ok: true };
}
