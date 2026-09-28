import fs from 'fs';
import path from 'path';
import {
  CONFIG_FILES,
  ConfigLayer,
  StampEntry,
  configStamp,
  configWatch,
  describeConfigLayers,
  projectConfigFiles
} from '../../shared/setup/configLayers.js';
import { extraConfigDir, globalConfigDir, opencodeEnvFor } from '../../shared/setup/locations.js';
import { pathContext } from '../app/appPaths.js';
import { SetupReport } from '../../shared/setup/report.js';
import { boardConfig, locationReport, locations, opencodeConfigFilePaths, opencodeGlobalConfigDirs } from './locations.js';

/**
 * OpenCode's config as the board's projects see it: which folders a model list
 * is read in, which config files each project adds, and the fingerprint that
 * says the running agent has an older copy (`shared/setup/configLayers.ts`
 * holds the rules; this module looks at the disk).
 *
 * The board's projects come in through `setBoardConfigSource`, set by the
 * composition root, so this module never opens the board's state itself — the
 * `--paths` CLI uses it with no board at all.
 */

export interface BoardConfigContext {
  projects: readonly { name: string; path: string }[];
  defaultCwd?: string;
  toolPolicy?: Record<string, boolean>;
}

let source: () => BoardConfigContext = () => ({ projects: [] });

export function setBoardConfigSource(next: () => BoardConfigContext): void {
  source = next;
}

function isDir(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/** The repository `dir` is in: the nearest folder above it with a `.git`. OpenCode stops looking for project config there. */
export function gitRoot(dir: string): string | undefined {
  let at = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(at, '.git'))) return at;
    const up = path.dirname(at);
    if (up === at) return undefined;
    at = up;
  }
}

/**
 * The folders a model list is read in: every board project that still exists,
 * and the default folder new tasks start in. A provider in one project's
 * `opencode.json` exists only for sessions there, so reading in one folder
 * alone is how a project's local models went missing.
 */
export function modelProbeFolders(): string[] {
  const { projects, defaultCwd } = source();
  const folders = [...projects.map((p) => p.path), ...(defaultCwd ? [defaultCwd] : [])]
    .filter((dir) => path.isAbsolute(dir) && isDir(dir))
    .map((dir) => path.resolve(dir));
  const unique = [...new Set(folders)];
  return unique.length > 0 ? unique : [process.cwd()];
}

function projectsWithRoots(): { name: string; cwd: string; root?: string }[] {
  return source().projects
    .filter((p) => path.isAbsolute(p.path) && isDir(p.path))
    .map((p) => ({ name: p.name, cwd: path.resolve(p.path), root: gitRoot(p.path) }));
}

/**
 * Every config file OpenCode merges for some board project, in its merge
 * order: the global files and `OPENCODE_CONFIG`, each project's own from its
 * root down to its folder (the nearer wins), then the extra folder's.
 */
export function mergedConfigFilePaths(): string[] {
  const all = opencodeConfigFilePaths();
  const extra = new Set(
    opencodeGlobalConfigDirs().slice(1).flatMap((dir) => CONFIG_FILES.map((name) => path.join(dir, name)))
  );
  const projects = projectsWithRoots().flatMap(({ cwd, root }) =>
    projectConfigFiles(cwd, root).filter(fileExists).reverse()
  );
  return [...new Set([...all.filter((f) => !extra.has(f)), ...projects, ...all.filter((f) => extra.has(f))])];
}

function fileExists(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function statOf(file: string): StampEntry['stat'] {
  try {
    const stat = fs.statSync(file);
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return null;
  }
}

function dirEntries(dir: string): StampEntry[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names.map((name) => ({ path: path.join(dir, name), stat: statOf(path.join(dir, name)) }));
}

/** How long a fingerprint is trusted. Every board load asks for one; a few dozen stats a second is plenty. */
const STAMP_CACHE_MS = 1_000;
let stampCache: { at: number; value: string } | null = null;

/**
 * The fingerprint of every config file and agent folder any session the board
 * starts could load. When it differs from the one the agent was started with,
 * the agent's model and agent lists are out of date.
 */
export function currentConfigStamp(): string {
  const now = Date.now();
  if (stampCache && now - stampCache.at < STAMP_CACHE_MS) return stampCache.value;
  const watch = configWatch({
    globalFiles: opencodeConfigFilePaths(),
    configDirs: opencodeGlobalConfigDirs(),
    projects: projectsWithRoots()
  });
  // Only what exists: creating a file still changes the stamp, but adding a
  // board project with no config of its own does not restart the agent.
  const entries = [
    ...watch.files.map((file) => ({ path: file, stat: statOf(file) })),
    ...watch.dirs.flatMap(dirEntries)
  ].filter((entry) => entry.stat);
  stampCache = { at: now, value: configStamp(entries) };
  return stampCache.value;
}

/** Every config layer, as the settings panel lists them. */
export function configLayers(): ConfigLayer[] {
  const config = boardConfig();
  const ctx = pathContext();
  const ocEnv = opencodeEnvFor(config, process.env);
  const { toolPolicy } = source();
  return describeConfigLayers({
    globalDir: globalConfigDir(ocEnv, ctx.home),
    extraDir: extraConfigDir(locations(), config, ctx),
    configFile: ocEnv.OPENCODE_CONFIG ? path.resolve(ocEnv.OPENCODE_CONFIG) : undefined,
    projects: projectsWithRoots().map(({ name, cwd, root }) => ({
      name,
      cwd,
      files: projectConfigFiles(cwd, root).filter(fileExists)
    })),
    toolPolicyCount: Object.keys(toolPolicy || {}).length,
    exists: fileExists
  });
}

/** Everything the setup screens show: where things are, and every config layer. */
export function setupReport(): SetupReport {
  return { ...locationReport(), configLayers: configLayers() };
}
