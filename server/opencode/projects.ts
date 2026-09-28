import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';
import { parseGitPorcelain } from '../../shared/git/worktree.js';
import { projectForFolder } from '../../shared/board/projectPaths.js';
import { mapLimit } from '../../shared/mapLimit.js';

const execFileAsync = promisify(execFile);

/**
 * Worktrees of one repo share its object database. Statusing a page of them
 * all at once is what drove the machine's load into the tens; a few at a time
 * finishes in about the same wall clock without the pile-up.
 */
const PROBE_CONCURRENCY = 3;

export function worktreeLabel(cwd: string, projectRoot?: string): string | undefined {
  if (!cwd) return undefined;
  const normalized = cwd.replace(/\/+$/, '');
  const root = projectRoot?.replace(/\/+$/, '');
  if (root && (normalized === root)) return undefined;

  const sibling = /\.worktrees\/([^/]+)$/.exec(normalized);
  if (sibling) return sibling[1];

  const oc = /\/opencode\/worktree\/[^/]+\/([^/]+)$/.exec(normalized);
  if (oc) return oc[1];

  return undefined;
}

/** The board project a folder belongs to, by name. */
export function matchProjectName(cwd: string, projects: { name: string; path: string }[]): string | undefined {
  return projectForFolder(cwd, projects)?.name;
}

export interface CwdProbe {
  exists: boolean;
  dirty: boolean;
  dirtyFiles: string[];
}

export async function probeDirectories(dirs: string[]): Promise<Map<string, CwdProbe>> {
  const unique = [...new Set(dirs.filter(Boolean))];
  const map = new Map<string, CwdProbe>();
  const worktrees: string[] = [];
  for (const dir of unique) {
    let exists = false;
    try {
      exists = fs.existsSync(dir) && fs.statSync(dir).isDirectory();
    } catch {
      exists = false;
    }
    // Main-repo dirtiness is shared by every session in that checkout and is
    // not a per-session signal. Skip git-status there.
    if (exists && worktreeLabel(dir)) {
      worktrees.push(dir);
    } else {
      map.set(dir, { exists, dirty: false, dirtyFiles: [] });
    }
  }
  await mapLimit(worktrees, PROBE_CONCURRENCY, async (dir) => {
    let dirtyFiles: string[] = [];
    try {
      const { stdout } = await execFileAsync('git', ['-C', dir, 'status', '--porcelain'], {
        timeout: 2000,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024
      });
      dirtyFiles = parseGitPorcelain(stdout);
    } catch {
      dirtyFiles = [];
    }
    map.set(dir, { exists: true, dirty: dirtyFiles.length > 0, dirtyFiles });
  });
  return map;
}

export function findProject(db: DatabaseSync, cwd: string): { id: string; worktree: string } | undefined {
  const exact = db.prepare('SELECT id, worktree FROM project WHERE worktree = ?').get(cwd) as
    | { id: string; worktree: string }
    | undefined;
  if (exact) return exact;

  const viaDir = db.prepare(
    'SELECT p.id, p.worktree FROM project_directory d JOIN project p ON p.id = d.project_id WHERE d.directory = ?'
  ).get(cwd) as { id: string; worktree: string } | undefined;
  if (viaDir) return viaDir;

  const sibling = /^(.*)\.worktrees\/[^/]+$/.exec(cwd.replace(/\/+$/, ''));
  if (sibling) {
    const parent = db.prepare('SELECT id, worktree FROM project WHERE worktree = ?').get(sibling[1] ?? '') as
      | { id: string; worktree: string }
      | undefined;
    if (parent) return parent;
  }

  const oc = /\/opencode\/worktree\/([^/]+)\//.exec(cwd);
  if (oc) {
    const byId = db.prepare('SELECT id, worktree FROM project WHERE id = ?').get(oc[1] ?? '') as
      | { id: string; worktree: string }
      | undefined;
    if (byId) return byId;
  }

  return undefined;
}
