import fs from 'fs';
import path from 'path';
import { BoardConfig, parseBoardConfig } from '../../shared/setup/locations.js';

/**
 * The board's setup file on disk: read, and written back.
 *
 * Kept apart from `server/setup/locations.ts` because `appPaths.dataDir()` needs the
 * configured data folder, and everything that writes a file needs `dataDir()`
 * — so this must not import anything that does. It takes the file's path as
 * an argument for the same reason.
 */

let cached: { file: string; mtimeMs: number; config: BoardConfig } | null = null;

/** The setup file at `file`, or an empty one when there is none (or `file` is null). Unreadable is empty too. */
export function readBoardConfig(file: string | null): BoardConfig {
  if (!file) return {};
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    return {};
  }
  if (cached && cached.file === file && cached.mtimeMs === mtimeMs) return cached.config;
  let config: BoardConfig = {};
  try {
    config = parseBoardConfig(JSON.parse(fs.readFileSync(file, 'utf-8')));
  } catch (e) {
    console.warn('[setup] Ignoring an unreadable setup file', file, (e as Error).message);
  }
  cached = { file, mtimeMs, config };
  return config;
}

/** Replace the setup file, through a temp file so a crash cannot leave half of one. */
export function writeBoardConfig(file: string, config: BoardConfig): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n');
  fs.renameSync(tmp, file);
  cached = null;
}
