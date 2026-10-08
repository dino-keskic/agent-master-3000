import path from 'path';
import { CONFIG_FILES, GLOBAL_FILES } from './configLayers.js';
import { LOCATION_KEYS, LocationKey, LocationSource } from './report.js';

/**
 * Where the board and OpenCode keep things, worked out from the environment,
 * the board's setup file and what a search of the disk turned up — in that
 * order of precedence.
 *
 * The defaults follow OpenCode's own rules (checked against 1.18 and 2.0 in
 * the sandbox), so the board reads what the agent writes:
 *
 * - config: `$XDG_CONFIG_HOME/opencode`, always. `OPENCODE_CONFIG_DIR` adds a
 *   folder on top of it rather than replacing it, and `OPENCODE_CONFIG` adds a
 *   file — so the location called `opencodeConfigDir` here is that *extra*
 *   folder, empty when there is none. `configLayers.ts` lists them all.
 * - sessions: `$XDG_DATA_HOME/opencode/opencode.db`, or
 *   `opencode-<channel>.db` beside it for a non-release build. `OPENCODE_DB`
 *   overrides it, relative to that folder when it is not absolute.
 * - model list: `$XDG_CACHE_HOME/opencode/models.json`, or
 *   `OPENCODE_MODELS_PATH`. 2.x writes no such file and caches the list in
 *   the sessions DB instead (`server/opencode/models.ts`).
 *
 * XDG applies on macOS and Windows too: OpenCode uses `~/.config` and friends
 * everywhere. A location changed in the setup file is handed to every OpenCode
 * the board starts through those same variables (`opencodeChildEnv`), so the
 * two cannot drift apart.
 *
 * Pure: the caller supplies the environment and whatever it found on disk.
 */

export interface BoardConfig {
  dataDir?: string;
  opencodeBin?: string;
  opencodeConfigDir?: string;
  opencodeDb?: string;
  opencodeModels?: string;
  /** Extra environment for every OpenCode the board starts. */
  opencodeEnv?: Record<string, string>;
  /** The data folder to copy the board from on the next start, into `dataDir`. */
  moveDataFrom?: string;
}

export interface PathContext {
  env: NodeJS.ProcessEnv;
  home: string;
  platform: NodeJS.Platform;
  cwd: string;
  /** The built app, as opposed to a checkout run by `tsx`. */
  bundled: boolean;
}

export interface ResolvedLocation {
  value: string;
  source: LocationSource;
  envVar?: string;
}

export type Locations = Record<LocationKey, ResolvedLocation>;

/** What a look at the disk found, for the locations that need one. */
export interface Discovered {
  /** The first executable OpenCode on the search path (`binCandidates`). */
  bin?: string;
  /** A channel database, when the release one does not exist (`pickChannelDb`). */
  channelDb?: string;
}

/** Variables that set a location outright, first match wins. */
const ENV_VARS: Record<LocationKey, readonly string[]> = {
  dataDir: ['AGENT_MASTER_DATA_DIR'],
  opencodeBin: ['OPENCODE_BIN'],
  opencodeConfigDir: ['OPENCODE_CONFIG_DIR'],
  opencodeDb: ['OPENCODE_DB'],
  // OPENCODE_MODELS is the board's older spelling; OpenCode reads the other.
  opencodeModels: ['OPENCODE_MODELS_PATH', 'OPENCODE_MODELS']
};

function absoluteOr(value: string | undefined, fallback: string): string {
  return value && path.isAbsolute(value) ? value : fallback;
}

/** XDG base directories. The spec says a relative one is invalid and must be ignored. */
export function xdgDirs(env: NodeJS.ProcessEnv, home: string): { config: string; data: string; cache: string } {
  return {
    config: absoluteOr(env.XDG_CONFIG_HOME, path.join(home, '.config')),
    data: absoluteOr(env.XDG_DATA_HOME, path.join(home, '.local', 'share')),
    cache: absoluteOr(env.XDG_CACHE_HOME, path.join(home, '.cache'))
  };
}

/** The environment OpenCode will see: the board's own, with the user's extras over it. */
export function opencodeEnvFor(config: BoardConfig, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, ...(config.opencodeEnv || {}) };
}

/** OpenCode's global config folder — always loaded, whatever else is configured. */
export function globalConfigDir(env: NodeJS.ProcessEnv, home: string): string {
  return path.join(xdgDirs(env, home).config, 'opencode');
}

/** OpenCode's data folder: the database, credentials, logs. */
export function opencodeDataDir(env: NodeJS.ProcessEnv, home: string): string {
  return path.join(xdgDirs(env, home).data, 'opencode');
}

/**
 * The board's setup file. It cannot live in the data folder, since it says
 * where the data folder is. A checkout keeps it in `./data` beside the board
 * it configures, so a dev board and an installed one never share it.
 */
export function boardConfigFile({ env, bundled, cwd, home, platform }: PathContext): string {
  if (env.AGENT_MASTER_CONFIG) return path.resolve(cwd, env.AGENT_MASTER_CONFIG);
  if (!bundled) return path.resolve(cwd, 'data', 'config.json');
  if (platform === 'win32') {
    return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'agent-master-3000', 'config.json');
  }
  return path.join(xdgDirs(env, home).config, 'agent-master-3000', 'config.json');
}

export interface DataDirInput extends PathContext {
  /** The setup file's choice. */
  configured?: string;
}

/**
 * `AGENT_MASTER_DATA_DIR` if set (relative to the cwd); the setup file's choice;
 * `./data` from a checkout; otherwise the XDG data directory —
 * `$XDG_DATA_HOME/agent-master-3000`, falling back to `~/.local/share/agent-master-3000`, on
 * macOS too, which is where OpenCode keeps its own. Windows gets
 * `%LOCALAPPDATA%\agent-master-3000`.
 */
export function resolveDataDir(input: DataDirInput): string {
  const { env, bundled, cwd, home, platform, configured } = input;
  if (env.AGENT_MASTER_DATA_DIR) return path.resolve(cwd, env.AGENT_MASTER_DATA_DIR);
  if (configured) return configured;
  if (!bundled) return path.resolve(cwd, 'data');
  if (platform === 'win32') {
    return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'agent-master-3000');
  }
  return path.join(xdgDirs(env, home).data, 'agent-master-3000');
}

function fromEnv(key: LocationKey, env: NodeJS.ProcessEnv): ResolvedLocation | undefined {
  for (const name of ENV_VARS[key]) {
    const value = env[name];
    if (value) return { value, source: 'env', envVar: name };
  }
  return undefined;
}

/** Every location, and who decided it. */
export function resolveLocations(config: BoardConfig, ctx: PathContext, found: Discovered = {}): Locations {
  const { env, home } = ctx;
  const ocEnv = opencodeEnvFor(config, env);

  const pick = (key: LocationKey, fallback: () => ResolvedLocation): ResolvedLocation => {
    const set = fromEnv(key, env);
    if (set) return set;
    const configured = config[key];
    if (typeof configured === 'string' && configured) return { value: configured, source: 'config' };
    return fallback();
  };

  const dataDefault = resolveDataDir({ ...ctx, configured: undefined });
  const locations: Locations = {
    dataDir: pick('dataDir', () => ({ value: dataDefault, source: 'default' })),
    opencodeBin: pick('opencodeBin', () =>
      found.bin ? { value: found.bin, source: 'detected' } : { value: 'opencode', source: 'default' }
    ),
    // No default: the global folder is loaded anyway, and naming it here made
    // it look like the one folder OpenCode reads.
    opencodeConfigDir: pick('opencodeConfigDir', () => ({ value: '', source: 'default' })),
    opencodeDb: pick('opencodeDb', () =>
      found.channelDb
        ? { value: found.channelDb, source: 'detected' }
        : { value: path.join(opencodeDataDir(ocEnv, home), 'opencode.db'), source: 'default' }
    ),
    opencodeModels: pick('opencodeModels', () => ({
      value: path.join(xdgDirs(ocEnv, home).cache, 'opencode', 'models.json'),
      source: 'default'
    }))
  };

  // Relative paths from the environment mean what they mean to whoever reads
  // the variable: the board's own from its cwd, OpenCode's DB from its data folder.
  const dataEnv = locations.dataDir;
  if (dataEnv.source === 'env') dataEnv.value = path.resolve(ctx.cwd, dataEnv.value);
  const db = locations.opencodeDb;
  if (db.source === 'env' && db.value !== ':memory:' && !path.isAbsolute(db.value)) {
    db.value = path.join(opencodeDataDir(ocEnv, home), db.value);
  }
  return locations;
}

/**
 * What every OpenCode the board starts gets on top of the board's own
 * environment: the user's extras, and each location the setup file moved. A
 * location that came from the environment is already in it, and a default or
 * a detected one is where OpenCode looks anyway.
 */
export function opencodeChildEnv(config: BoardConfig, locations: Locations): Record<string, string> {
  const out: Record<string, string> = { ...(config.opencodeEnv || {}) };
  if (locations.opencodeConfigDir.source === 'config') out.OPENCODE_CONFIG_DIR = locations.opencodeConfigDir.value;
  if (locations.opencodeDb.source === 'config') out.OPENCODE_DB = locations.opencodeDb.value;
  if (locations.opencodeModels.source === 'config') out.OPENCODE_MODELS_PATH = locations.opencodeModels.value;
  return out;
}

/** The extra config folder, when one is set and it is not the global folder under another name. */
export function extraConfigDir(locations: Locations, config: BoardConfig, ctx: Pick<PathContext, 'env' | 'home'>): string | undefined {
  const extra = locations.opencodeConfigDir.value;
  if (!extra) return undefined;
  const global = globalConfigDir(opencodeEnvFor(config, ctx.env), ctx.home);
  return path.resolve(extra) === path.resolve(global) ? undefined : extra;
}

/**
 * The config files every session loads, in OpenCode's merge order: the global
 * folder's three names, `OPENCODE_CONFIG`, then the extra folder's two. Project
 * files come between the last two, per project (`configLayers.ts`).
 */
export function opencodeConfigFiles(locations: Locations, config: BoardConfig, ctx: Pick<PathContext, 'env' | 'home'>): string[] {
  const ocEnv = opencodeEnvFor(config, ctx.env);
  const global = globalConfigDir(ocEnv, ctx.home);
  const files: string[] = GLOBAL_FILES.map((name) => path.join(global, name));
  if (ocEnv.OPENCODE_CONFIG) files.push(path.resolve(ocEnv.OPENCODE_CONFIG));
  const extra = extraConfigDir(locations, config, ctx);
  if (extra) files.push(...CONFIG_FILES.map((name) => path.join(extra, name)));
  return files;
}

/** The folders OpenCode loads agents, commands and skills from: the global one, then the extra one. */
export function opencodeConfigDirs(locations: Locations, config: BoardConfig, ctx: Pick<PathContext, 'env' | 'home'>): string[] {
  const global = globalConfigDir(opencodeEnvFor(config, ctx.env), ctx.home);
  const extra = extraConfigDir(locations, config, ctx);
  return extra ? [global, extra] : [global];
}

/**
 * Where to look for the `opencode` executable, in order: every folder on
 * PATH, then the places its installers put it. The fallbacks are what make a
 * board started outside a login shell — by launchd, a desktop shortcut — find
 * the same OpenCode the user's terminal does.
 */
export function binCandidates(env: NodeJS.ProcessEnv, home: string, platform: NodeJS.Platform): string[] {
  const win = platform === 'win32';
  const p = win ? path.win32 : path.posix;
  const names = win ? ['opencode.exe', 'opencode.cmd'] : ['opencode'];
  const pathDirs = (env.PATH || env.Path || '').split(win ? ';' : ':').filter(Boolean);
  const installDirs = win
    ? [p.join(home, '.opencode', 'bin'), p.join(env.APPDATA || p.join(home, 'AppData', 'Roaming'), 'npm')]
    : [
        p.join(home, '.opencode', 'bin'),
        p.join(home, '.local', 'bin'),
        p.join(home, '.bun', 'bin'),
        p.join(home, '.npm-global', 'bin'),
        p.join(home, '.volta', 'bin'),
        p.join(home, 'Library', 'pnpm'),
        p.join(home, '.local', 'share', 'pnpm'),
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin'
      ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of [...pathDirs, ...installDirs]) {
    if (!p.isAbsolute(dir)) continue;
    for (const name of names) {
      const file = p.join(dir, name);
      if (!seen.has(file)) {
        seen.add(file);
        out.push(file);
      }
    }
  }
  return out;
}

/**
 * The sessions database in OpenCode's data folder, given what is in it.
 * `opencode.db` is the release build's; any other build names its own after
 * its channel, and the most recently written of those is the one in use.
 */
export function pickChannelDb(entries: readonly { name: string; mtimeMs: number }[]): string | undefined {
  if (entries.some((e) => e.name === 'opencode.db')) return 'opencode.db';
  const channel = entries
    .filter((e) => /^opencode-[a-zA-Z0-9._-]+\.db$/.test(e.name))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return channel[0]?.name;
}

/** Only what a setup file may hold, with anything malformed dropped rather than trusted. */
export function parseBoardConfig(raw: unknown): BoardConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const out: BoardConfig = {};
  for (const key of LOCATION_KEYS) {
    const value = source[key];
    if (typeof value === 'string' && path.isAbsolute(value)) out[key] = value;
  }
  if (typeof source.moveDataFrom === 'string' && path.isAbsolute(source.moveDataFrom)) {
    out.moveDataFrom = source.moveDataFrom;
  }
  const env = source.opencodeEnv;
  if (env && typeof env === 'object' && !Array.isArray(env)) {
    const clean: Record<string, string> = {};
    for (const [name, value] of Object.entries(env as Record<string, unknown>)) {
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && typeof value === 'string') clean[name] = value;
    }
    if (Object.keys(clean).length > 0) out.opencodeEnv = clean;
  }
  return out;
}

/** The pieces of a board's data folder, relative to it, that a move copies. */
export const BOARD_DATA_ENTRIES = ['board_state.json', 'board_state.json.logs', 'attachments'] as const;

/**
 * What moving a board into a new data folder copies, given what is in the old
 * one. Nothing at all if the new one already has a board — two boards are
 * never merged, and the one already there wins. The document goes last, so a
 * copy cut short does not leave something that looks like a whole board.
 */
export function dataMovePlan(present: readonly string[], targetHasBoard: boolean): string[] {
  if (targetHasBoard || !present.includes('board_state.json')) return [];
  return [...BOARD_DATA_ENTRIES.filter((entry) => entry !== 'board_state.json' && present.includes(entry)), 'board_state.json'];
}
