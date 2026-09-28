import path from 'path';

/**
 * Every place OpenCode reads its config from, in the order it merges them, and
 * a fingerprint of all of it — so the board can show where a model or an agent
 * comes from, and tell when the running agent is reading an older copy.
 *
 * OpenCode (checked against 1.18 in the sandbox) merges, later wins:
 *
 * 1. the global folder, `$XDG_CONFIG_HOME/opencode` — always, whatever else is set;
 * 2. `OPENCODE_CONFIG`, one extra file;
 * 3. the project: `opencode.json(c)` and `.opencode/` from the folder a session
 *    runs in up to its git root — so a project's providers exist only for
 *    sessions in that project;
 * 4. `OPENCODE_CONFIG_DIR`, one extra folder on top of the global one;
 * 5. `OPENCODE_CONFIG_CONTENT` — the board's own tool policy.
 *
 * A running `opencode acp` reads all of it once and never again: an edit, even
 * one to a project it has not opened yet, is only seen by a new process. That
 * is what the fingerprint is for.
 *
 * Pure: the server says what exists and when it changed.
 */

/** Config files OpenCode reads from its global folder, in order. */
export const GLOBAL_FILES = ['config.json', 'opencode.json', 'opencode.jsonc'] as const;
/** Config files it reads from any other config folder: the extra one, a project, a `.opencode`. */
export const CONFIG_FILES = ['opencode.json', 'opencode.jsonc'] as const;
/**
 * Folders of markdown agents inside a config folder. Commands and skills are
 * read fresh by the board itself; agents change what the agent offers, so an
 * added or edited one has to reach the running process.
 */
export const AGENT_SUBDIRS = ['agent', 'agents', 'mode', 'modes'] as const;

/**
 * The folders from `cwd` up to `stopAt` (a git root) inclusive, nearest first
 * — where OpenCode looks for a project's config. Without a root, or with one
 * that is not above `cwd`, it walks to the top of the disk, as OpenCode does
 * outside a repository.
 */
export function projectConfigFolders(cwd: string, stopAt?: string): string[] {
  const start = path.resolve(cwd);
  const stop = stopAt ? path.resolve(stopAt) : undefined;
  const inside = stop && (start === stop || start.startsWith(stop.endsWith(path.sep) ? stop : stop + path.sep));
  const out: string[] = [];
  let at = start;
  for (;;) {
    out.push(at);
    if (inside && at === stop) break;
    const up = path.dirname(at);
    if (up === at) break;
    at = up;
  }
  return out;
}

/** The project config files a session in `cwd` could load, nearest folder first. */
export function projectConfigFiles(cwd: string, stopAt?: string): string[] {
  return projectConfigFolders(cwd, stopAt).flatMap((dir) => [
    ...CONFIG_FILES.map((name) => path.join(dir, name)),
    ...CONFIG_FILES.map((name) => path.join(dir, '.opencode', name))
  ]);
}

/** The `.opencode` folders a session in `cwd` could load agents from. */
export function projectConfigDirs(cwd: string, stopAt?: string): string[] {
  return projectConfigFolders(cwd, stopAt).map((dir) => path.join(dir, '.opencode'));
}

/** What the fingerprint is taken over: files to stat, and folders whose entries to stat. */
export interface ConfigWatch {
  files: string[];
  dirs: string[];
}

/**
 * Everything whose change the running agent would miss: the global and extra
 * config files and `OPENCODE_CONFIG` (`globalFiles`), each config folder's
 * agent folders, and every project's files and agent folders.
 */
export function configWatch(input: {
  globalFiles: readonly string[];
  configDirs: readonly string[];
  projects: readonly { cwd: string; root?: string }[];
}): ConfigWatch {
  const files = new Set<string>(input.globalFiles);
  const dirs = new Set<string>();
  const agentDirs = (dir: string) => AGENT_SUBDIRS.forEach((sub) => dirs.add(path.join(dir, sub)));
  input.configDirs.forEach(agentDirs);
  for (const { cwd, root } of input.projects) {
    projectConfigFiles(cwd, root).forEach((file) => files.add(file));
    projectConfigDirs(cwd, root).forEach(agentDirs);
  }
  return { files: [...files].sort(), dirs: [...dirs].sort() };
}

/** One stat. A missing path is `null`, so creating it counts as a change. */
export interface StampEntry {
  path: string;
  stat: { mtimeMs: number; size: number } | null;
}

/**
 * The fingerprint: equal exactly when nothing watched was added, removed or
 * written. Order-free, so the same files listed differently match.
 */
export function configStamp(entries: readonly StampEntry[]): string {
  return entries
    .map((e) => `${e.path}\t${e.stat ? `${Math.round(e.stat.mtimeMs)}:${e.stat.size}` : '-'}`)
    .sort()
    .join('\n');
}

export type ConfigLayerKind = 'global' | 'file' | 'project' | 'extra' | 'board';

export interface ConfigLayer {
  kind: ConfigLayerKind;
  title: string;
  /** The folder or file this layer is. Empty for the board's inline layer. */
  path: string;
  /** Config files in it that exist. */
  files: string[];
  note: string;
}

export interface ConfigLayerInput {
  globalDir: string;
  /** `OPENCODE_CONFIG_DIR`, when set and not the global folder itself. */
  extraDir?: string;
  /** `OPENCODE_CONFIG`, when set. */
  configFile?: string;
  projects: readonly { name: string; cwd: string; files: readonly string[] }[];
  /** Tools the board turns on or off for every session. */
  toolPolicyCount: number;
  exists: (file: string) => boolean;
}

/** The layers as the settings panel and `--paths` list them, in OpenCode's merge order. */
export function describeConfigLayers(input: ConfigLayerInput): ConfigLayer[] {
  const present = (dir: string, names: readonly string[]) =>
    names.map((name) => path.join(dir, name)).filter(input.exists);
  const layers: ConfigLayer[] = [];

  const globalFiles = present(input.globalDir, GLOBAL_FILES);
  layers.push({
    kind: 'global',
    title: 'Global',
    path: input.globalDir,
    files: globalFiles,
    note: globalFiles.length > 0
      ? 'Always loaded, for every project.'
      : 'Always loaded, but has no opencode.json yet.'
  });

  if (input.configFile) {
    const found = input.exists(input.configFile);
    layers.push({
      kind: 'file',
      title: 'OPENCODE_CONFIG',
      path: input.configFile,
      files: found ? [input.configFile] : [],
      note: found ? 'Loaded on top of the global config.' : 'Set, but the file does not exist.'
    });
  }

  for (const project of input.projects) {
    layers.push({
      kind: 'project',
      title: `Project: ${project.name}`,
      path: project.cwd,
      files: [...project.files],
      note: project.files.length > 0
        ? 'Loaded only for tasks in this project.'
        : 'No project config — tasks here use the layers above.'
    });
  }

  if (input.extraDir) {
    const extraFiles = present(input.extraDir, CONFIG_FILES);
    layers.push({
      kind: 'extra',
      title: 'OPENCODE_CONFIG_DIR',
      path: input.extraDir,
      files: extraFiles,
      note: extraFiles.length > 0
        ? 'Loaded on top of the global folder, not instead of it.'
        : 'Loaded on top of the global folder; has no opencode.json.'
    });
  }

  layers.push({
    kind: 'board',
    title: 'Board tool policy',
    path: '',
    files: [],
    note: input.toolPolicyCount > 0
      ? `${input.toolPolicyCount} tool rule${input.toolPolicyCount === 1 ? '' : 's'} from Settings → Tools, applied last.`
      : 'Nothing set in Settings → Tools.'
  });
  return layers;
}
