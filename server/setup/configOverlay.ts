import fs from 'fs';
import path from 'path';
import { OverlayEntry, OverlaySide, configOverlayPath, planOverlayLevel } from '../../shared/setup/configOverlay.js';
import { DEFAULT_FILE_PATH } from '../board/stateFile.js';

/**
 * Building the config folder an OpenCode 2 is started on when an extra config
 * folder is set (`shared/setup/configOverlay.ts` says why and what it holds).
 *
 * What belongs here: the disk. The folder is the board's own and is brought in
 * line with the plan in place on every start — links that are right are left
 * alone, so an OpenCode already watching it sees nothing change, and anything
 * else in it goes.
 */

function entries(dir: string): OverlayEntry[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names.map((name) => {
    let isDir = false;
    try {
      isDir = fs.statSync(path.join(dir, name)).isDirectory();
    } catch {
      // A broken link is linked as it is; OpenCode skips it the same either way.
    }
    return { name, dir: isDir };
  });
}

function remove(file: string): void {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return;
  // A link is unlinked, never followed: what it points at is the user's.
  if (stat.isSymbolicLink() || !stat.isDirectory()) fs.unlinkSync(file);
  else fs.rmSync(file, { recursive: true, force: true });
}

function link(target: string, file: string): void {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (stat?.isSymbolicLink() && fs.readlinkSync(file) === target) return;
  if (stat) remove(file);
  // `junction` only matters on Windows, where a folder link needs no privilege that way.
  const isDir = fs.statSync(target, { throwIfNoEntry: false })?.isDirectory();
  fs.symlinkSync(target, file, isDir ? 'junction' : 'file');
}

function realDir(dir: string): void {
  const stat = fs.lstatSync(dir, { throwIfNoEntry: false });
  if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) remove(dir);
  fs.mkdirSync(dir, { recursive: true });
}

/** One folder of the overlay, and the ones below it it merges. Returns what did not fit. */
function syncLevel(out: string, roots: Record<OverlaySide, string>, rel: string, depth: number): string[] {
  realDir(out);
  const level = planOverlayLevel(entries(path.join(roots.global, rel)), entries(path.join(roots.extra, rel)), depth);
  const wanted = new Set([...level.links.map((l) => l.name), ...level.merge]);
  for (const name of fs.readdirSync(out)) if (!wanted.has(name)) remove(path.join(out, name));
  for (const l of level.links) link(path.join(roots[l.side], rel, l.from ?? l.name), path.join(out, l.name));
  const dropped = level.dropped.map((d) => path.join(roots[d.side], rel, d.name));
  for (const name of level.merge) dropped.push(...syncLevel(path.join(out, name), roots, path.join(rel, name), depth + 1));
  return dropped;
}

let warned = '';

/**
 * The overlay of `globalDir` and `extraDir`, brought up to date, or undefined
 * when it cannot be built (a filesystem without links): then OpenCode gets the
 * extra folder alone, as it would without the board.
 */
export function buildConfigOverlay(globalDir: string, extraDir: string, out = configOverlayPath(DEFAULT_FILE_PATH)): string | undefined {
  try {
    const dropped = syncLevel(out, { global: path.resolve(globalDir), extra: path.resolve(extraDir) }, '', 0);
    const note = dropped.join(', ');
    if (note && note !== warned) {
      console.warn(`[config] OpenCode 2 reads two config files from a folder; not loading ${note}.`);
    }
    warned = note;
    return out;
  } catch (e) {
    console.warn(`[config] Could not build ${out}; OpenCode 2 will not see ${globalDir}:`, e);
    return undefined;
  }
}
