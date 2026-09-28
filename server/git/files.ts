import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { FileItem } from '../../shared/trackers/mentions.js';
import { errorMessage } from '../../shared/errors.js';

const execFileAsync = promisify(execFile);
const LIST_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 30_000;
const MAX_WALK = 20_000;

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', 'target', '.next', '.nuxt',
  'vendor', 'Pods', '.venv', 'venv', '__pycache__', '.gradle', '.idea', 'coverage'
]);

interface ListCache {
  at: number;
  paths: string[];
}

const listCache = new Map<string, ListCache>();

/**
 * Every tracked and untracked-but-not-ignored file. `git ls-files` is the fast
 * path and the only one that already knows what the repo ignores; the walk is
 * for folders that are not repos at all.
 */
async function gitFiles(cwd: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd, timeout: LIST_TIMEOUT_MS, maxBuffer: 32_000_000 }
  );
  return stdout.split('\0').filter(Boolean);
}

function walk(root: string): string[] {
  const found: string[] = [];
  const queue: string[] = [''];
  while (queue.length > 0 && found.length < MAX_WALK) {
    const rel = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.github') continue;
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) queue.push(next);
      } else if (entry.isFile()) {
        found.push(next);
        if (found.length >= MAX_WALK) break;
      }
    }
  }
  return found;
}

async function listFiles(cwd: string): Promise<string[]> {
  const hit = listCache.get(cwd);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.paths;
  let paths: string[];
  try {
    paths = await gitFiles(cwd);
  } catch {
    paths = walk(cwd);
  }
  listCache.set(cwd, { at: Date.now(), paths });
  return paths;
}

/**
 * Rank a path against what has been typed. A hit on the file name beats a hit
 * anywhere in the folders above it, which is what "@Composer" is asking for;
 * a scattered subsequence match over the name is the last resort so `@cmpsr`
 * still lands — spread over the whole path it matches almost everything.
 */
export function scoreFilePath(relative: string, needle: string): number {
  if (!needle) return 100 - Math.min(relative.length, 90);
  const lowerPath = relative.toLowerCase();
  const name = relative.slice(relative.lastIndexOf('/') + 1).toLowerCase();
  const q = needle.toLowerCase();

  let score = -1;
  if (name === q) score = 1000;
  else if (name.startsWith(q)) score = 900;
  else if (name.includes(q)) score = 800;
  else if (lowerPath.includes(q)) score = 700;
  else if (subsequence(name, q)) score = 500;
  if (score < 0) return -1;

  // Shallow, short paths first — `src/api.ts` before `a/b/c/d/api.test.ts`.
  return score - relative.split('/').length * 4 - Math.min(relative.length, 80) / 10;
}

function subsequence(haystack: string, needle: string): boolean {
  let i = 0;
  for (const char of haystack) {
    if (char === needle[i]) i += 1;
    if (i === needle.length) return true;
  }
  return needle.length === 0;
}

export async function searchFiles(
  cwd: string,
  query: string,
  limit = 20
): Promise<{ items: FileItem[]; error?: string }> {
  try {
    const paths = await listFiles(cwd);
    const needle = query.trim().replace(/^@/, '');
    const scored: { path: string; score: number }[] = [];
    for (const relative of paths) {
      const score = scoreFilePath(relative, needle);
      if (score >= 0) scored.push({ path: relative, score });
    }
    scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    return {
      items: scored.slice(0, limit).map(({ path: relative }) => ({
        path: relative,
        name: relative.slice(relative.lastIndexOf('/') + 1)
      }))
    };
  } catch (e) {
    return { items: [], error: errorMessage(e) || 'Could not list files' };
  }
}
