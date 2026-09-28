import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { errorField, errorMessage } from '../../shared/errors.js';

const execFileAsync = promisify(execFile);

/**
 * Editors the board knows how to launch. Each entry is a fixed argv template —
 * nothing from the request is ever interpolated into a shell string, and the
 * command itself can only come from this table.
 */
export const EDITORS = {
  vscode: { label: 'VS Code', bin: 'code', dirArgs: (p: string) => [p], fileArgs: (p: string, line?: number) => (line ? ['--goto', `${p}:${line}`] : [p]) },
  cursor: { label: 'Cursor', bin: 'cursor', dirArgs: (p: string) => [p], fileArgs: (p: string, line?: number) => (line ? ['--goto', `${p}:${line}`] : [p]) },
  windsurf: { label: 'Windsurf', bin: 'windsurf', dirArgs: (p: string) => [p], fileArgs: (p: string, line?: number) => (line ? ['--goto', `${p}:${line}`] : [p]) },
  zed: { label: 'Zed', bin: 'zed', dirArgs: (p: string) => [p], fileArgs: (p: string, line?: number) => [line ? `${p}:${line}` : p] },
  webstorm: { label: 'WebStorm', bin: 'webstorm', dirArgs: (p: string) => [p], fileArgs: (p: string, line?: number) => (line ? ['--line', String(line), p] : [p]) },
  finder: { label: 'Finder', bin: 'open', dirArgs: (p: string) => [p], fileArgs: (p: string) => ['-R', p] }
} as const;

export type EditorId = keyof typeof EDITORS;

export function isEditorId(value: unknown): value is EditorId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(EDITORS, value);
}

/**
 * The board must never become a "run any binary on any path" endpoint just
 * because it listens on localhost. A target is only opened when it resolves
 * inside one of the folders the user has actually added to the board.
 */
export function resolveWithinRoots(target: string, roots: string[]): string | undefined {
  if (!target) return undefined;
  const resolved = path.resolve(target);
  for (const root of roots) {
    if (!root) continue;
    const base = path.resolve(root);
    if (resolved === base || resolved.startsWith(`${base}${path.sep}`)) return resolved;
  }
  return undefined;
}

/**
 * The absolute form of a target, for the checks that are about what named it
 * rather than where it lives.
 */
export function absoluteTarget(target: string): string | undefined {
  if (!target) return undefined;
  return path.resolve(target);
}

/**
 * Which editors are actually installed. Resolved once per process: the menu
 * should not offer a "Cursor" entry that can only ever fail.
 */
let availableCache: Promise<EditorId[]> | undefined;

export function availableEditors(): Promise<EditorId[]> {
  availableCache ??= (async () => {
    // A PATH scan rather than `command -v`: spawning a shell per editor is both
    // slower and the thing Node's DEP0190 warns about when args are passed
    // alongside `shell`.
    const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
    const ids = Object.keys(EDITORS) as EditorId[];
    const found = await Promise.all(
      ids.map(async (id) => ((await onPath(EDITORS[id].bin, dirs)) ? id : undefined))
    );
    return found.filter((id): id is EditorId => !!id);
  })();
  return availableCache;
}

async function onPath(bin: string, dirs: string[]): Promise<boolean> {
  for (const dir of dirs) {
    try {
      await fs.promises.access(path.join(dir, bin), fs.constants.X_OK);
      return true;
    } catch {
      // Not in this directory — keep looking.
    }
  }
  return false;
}

export interface OpenRequest {
  editor: EditorId;
  /** Absolute path to a file or folder, already checked against the roots. */
  target: string;
  line?: number;
}

export async function openInEditor({ editor, target, line }: OpenRequest): Promise<void> {
  const spec = EDITORS[editor];
  if (!fs.existsSync(target)) throw new Error('That path no longer exists');

  const isDir = fs.statSync(target).isDirectory();
  const args = isDir ? spec.dirArgs(target) : spec.fileArgs(target, line);

  try {
    await execFileAsync(spec.bin, args, { timeout: 10_000 });
  } catch (e) {
    if (errorField(e, 'code') === 'ENOENT') {
      throw new Error(
        `${spec.label} isn't on your PATH. In VS Code run "Shell Command: Install 'code' command in PATH".`
      );
    }
    throw new Error(errorMessage(e) || `Could not open ${spec.label}`);
  }
}
