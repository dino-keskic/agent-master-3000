import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import {
  WORKTREE_DIR,
  WorktreeEntry,
  parseWorktreeList,
  worktreeBranch,
  worktreeName,
  worktreePath
} from '../../shared/git/worktree.js';
import { TicketRef } from '../../shared/task/links.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[], timeout = 15000): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout,
    encoding: 'utf8'
  });
  return stdout.trim();
}

export interface GitInfo {
  isRepo: boolean;
  branch?: string;
  root?: string;
}

export async function gitInfo(cwd: string): Promise<GitInfo> {
  if (!cwd || !fs.existsSync(cwd)) return { isRepo: false };
  try {
    const root = await git(cwd, ['rev-parse', '--show-toplevel']);
    const branch = await git(cwd, ['branch', '--show-current']);
    return { isRepo: true, root, branch: branch || undefined };
  } catch {
    return { isRepo: false };
  }
}

/** Every checkout of the repo `cwd` belongs to, main worktree first. Empty when not a repo. */
export async function listWorktrees(cwd: string): Promise<WorktreeEntry[]> {
  const info = await gitInfo(cwd);
  if (!info.isRepo || !info.root) return [];
  try {
    return parseWorktreeList(await git(info.root, ['worktree', 'list', '--porcelain']));
  } catch {
    return [];
  }
}

export interface CreatedWorktree {
  path: string;
  name: string;
  branch: string;
  root: string;
  /** The branch the new one was cut from. */
  base?: string;
  /** True when that base was refreshed from its remote first. */
  baseUpdated?: boolean;
}

export interface WorktreeRequest {
  /** Free text about the work — used for the name when there is no ticket. */
  name?: string;
  /** The tracked work this is for. Names the branch and the folder when present. */
  ticket?: TicketRef;
}

/** The remote to refresh from: `origin` when it exists, else whatever is configured. */
async function baseRemote(root: string): Promise<string | undefined> {
  try {
    const remotes = (await git(root, ['remote'])).split('\n').map((line) => line.trim()).filter(Boolean);
    return remotes.includes('origin') ? 'origin' : remotes[0];
  } catch {
    return undefined;
  }
}

/**
 * The commit a new branch should start from.
 *
 * Branching off whatever the checkout happens to be sitting on is how work
 * starts a week behind: the folder was last pulled whenever someone last
 * touched it. So the base branch is fetched first and the branch is cut from
 * the remote's tip. Only that new branch is moved — the checkout the user is
 * looking at keeps whatever it had.
 *
 * A fetch that fails is not a reason to refuse the worktree: offline, or a
 * repository with no remote at all, still gets a branch, just off the local
 * base, and says so.
 */
async function baseStartPoint(root: string, branch?: string): Promise<{ base?: string; startPoint: string; updated: boolean }> {
  const base = branch || undefined;
  if (!base) return { startPoint: 'HEAD', updated: false };

  const remote = await baseRemote(root);
  if (!remote) return { base, startPoint: base, updated: false };

  try {
    await git(root, ['fetch', '--quiet', remote, base], 60000);
  } catch (e) {
    console.warn(`[Git] Could not refresh ${remote}/${base}:`, e);
    return { base, startPoint: base, updated: false };
  }

  const tracked = `${remote}/${base}`;
  if (!(await refExists(root, `refs/remotes/${tracked}`))) return { base, startPoint: base, updated: false };
  return { base, startPoint: tracked, updated: true };
}

/**
 * A worktree cannot be committed, so keep it out of the repository's status
 * without editing a tracked `.gitignore` — `.git/info/exclude` is this
 * checkout's own ignore list and belongs to nobody else's diff.
 */
function excludeWorktreeDir(root: string): void {
  try {
    const gitDir = path.join(root, '.git');
    // A worktree of a worktree: `.git` is a file pointing at the real dir.
    if (!fs.statSync(gitDir).isDirectory()) return;
    const file = path.join(gitDir, 'info', 'exclude');
    const line = `/${WORKTREE_DIR}/`;
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (current.split('\n').some((entry) => entry.trim() === line)) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${current}${current.endsWith('\n') || !current ? '' : '\n'}${line}\n`);
  } catch (e) {
    console.warn('[Git] Could not exclude the worktree folder:', e);
  }
}

/**
 * Cut a fresh checkout for a piece of work, inside the repository and off an
 * up-to-date base.
 *
 * The name is the ticket's when the task has one — a branch called
 * `acp/web-1234` is the one everybody else can find — and only otherwise
 * derived from the text describing the work.
 */
export async function createTaskWorktree(cwd: string, request: WorktreeRequest = {}): Promise<CreatedWorktree> {
  const info = await gitInfo(cwd);
  if (!info.isRepo || !info.root) {
    throw new Error('Not a git repository — cannot create a worktree');
  }

  const slug = worktreeName(request.ticket, request.name || '', `task-${Date.now().toString(36)}`);
  let dest = worktreePath(info.root, slug);
  let branch = worktreeBranch(slug);
  let n = 2;
  while (fs.existsSync(dest) || await refExists(info.root, `refs/heads/${branch}`)) {
    const next = `${slug}-${n}`;
    dest = worktreePath(info.root, next);
    branch = worktreeBranch(next);
    n += 1;
    if (n > 20) throw new Error('Could not allocate a free worktree name');
  }

  const { base, startPoint, updated } = await baseStartPoint(info.root, info.branch);
  excludeWorktreeDir(info.root);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await git(info.root, ['worktree', 'add', '-b', branch, dest, startPoint], 60000);

  return { path: dest, name: path.basename(dest), branch, root: info.root, base, baseUpdated: updated };
}

/** `ref` is a full ref name — `refs/heads/x`, `refs/remotes/origin/x`. */
async function refExists(root: string, ref: string): Promise<boolean> {
  try {
    await git(root, ['show-ref', '--verify', '--quiet', ref]);
    return true;
  } catch {
    return false;
  }
}
