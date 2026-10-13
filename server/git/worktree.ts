import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import {
  WORKTREE_DIR,
  WorktreeEntry,
  branchFolder,
  parseRemotes,
  pullRequestBranchName,
  parseWorktreeList,
  remoteForRepo,
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
  /** The pull request whose branch this checkout holds. */
  pullRequest?: number;
  /** True when that branch already had a checkout, and this is it. */
  existing?: boolean;
}

export interface WorktreeRequest {
  /** Free text about the work — used for the name when there is no ticket. */
  name?: string;
  /** The tracked work this is for. Names the branch and the folder when present. */
  ticket?: TicketRef;
  /**
   * A pull request the work is on, with its branch already looked up. Its
   * branch is checked out rather than a new one cut — falling back to a new
   * branch only when this repository cannot reach it.
   */
  pullRequest?: { repo: string; number: number; branch: string; forkOwner?: string };
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
 * derived from the text describing the work. Work on a pull request does not
 * get a branch at all: it gets the PR's.
 */
export async function createTaskWorktree(cwd: string, request: WorktreeRequest = {}): Promise<CreatedWorktree> {
  const info = await gitInfo(cwd);
  if (!info.isRepo || !info.root) {
    throw new Error('Not a git repository — cannot create a worktree');
  }

  if (request.pullRequest) {
    const checkout = await checkoutPullRequest(info.root, request.pullRequest);
    if (checkout) return checkout;
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

/**
 * A checkout of a pull request's own branch, named after it.
 *
 * The branch is used as it is: a local one is checked out untouched — it may
 * hold commits nobody pushed — and otherwise it is fetched and set to track
 * the remote, so a push lands on the PR. A fork's branch is fetched through
 * `pull/N/head`, under the name `pullRequestBranchName` gives it.
 *
 * Undefined when the PR is not this repository's, or its branch cannot be
 * fetched: the caller cuts a new branch instead.
 */
async function checkoutPullRequest(
  root: string,
  pr: NonNullable<WorktreeRequest['pullRequest']>
): Promise<CreatedWorktree | undefined> {
  const config = await git(root, ['config', '--get-regexp', '^remote\\..*\\.url$']).catch(() => '');
  const remote = remoteForRepo(parseRemotes(config), pr.repo);
  if (!remote) {
    console.warn(`[Git] ${pr.repo}#${pr.number} is not a pull request on ${root} — cutting a new branch`);
    return undefined;
  }

  const branch = pullRequestBranchName(pr);
  const made = { branch, root, pullRequest: pr.number };

  // Git checks a branch out in one place only, so an open checkout of it is the answer.
  const open = (await listWorktrees(root)).find((entry) => entry.branch === branch && !entry.prunable);
  if (open) return { ...made, path: open.path, name: path.basename(open.path), existing: true };

  const folder = branchFolder(branch) || `pr-${pr.number}`;
  let dest = worktreePath(root, folder);
  for (let n = 2; fs.existsSync(dest); n += 1) {
    if (n > 20) throw new Error('Could not allocate a free worktree name');
    dest = worktreePath(root, `${folder}-${n}`);
  }

  let args = ['worktree', 'add', dest, branch];
  if (!(await refExists(root, `refs/heads/${branch}`))) {
    const tracking = `refs/remotes/${remote}/${pr.branch}`;
    try {
      if (pr.forkOwner) {
        await git(root, ['fetch', '--quiet', remote, `+refs/pull/${pr.number}/head:refs/heads/${branch}`], 60000);
      } else {
        await git(root, ['fetch', '--quiet', remote, `+refs/heads/${pr.branch}:${tracking}`], 60000);
        args = ['worktree', 'add', '--track', '-b', branch, dest, `${remote}/${pr.branch}`];
      }
    } catch (e) {
      console.warn(`[Git] Could not fetch the branch of ${pr.repo}#${pr.number}:`, e);
      return undefined;
    }
  }

  excludeWorktreeDir(root);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await git(root, args, 60000);
  return { ...made, path: dest, name: path.basename(dest) };
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
