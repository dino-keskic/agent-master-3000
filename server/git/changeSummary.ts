/**
 * The change summary behind a board card.
 *
 * The drawer still reads a full patch (`server/git/diff.ts`). A card does not.
 * This asks git for names and line counts only, refuses LFS text conversion,
 * and reads one folder of a task at a time. The route admits two tasks at
 * once. A full diff per worktree, parsed in process, is what pinned the machine.
 */

import fs from 'fs';
import path from 'path';
import { ChangeFile, TaskChangeSummary, WorkspaceChangeSummary, filesForCard } from '../../shared/git/changeSummary.js';
import { changeFilesFromStat } from '../../shared/git/diffStat.js';
import { sumDiffStats } from '../../shared/git/diff.js';
import { TaskWorkspace } from '../../shared/task/workspaces.js';
import { resolveBaseRef, runGit } from './diff.js';
import { mapLimit } from '../../shared/mapLimit.js';

/**
 * Folders of one task, one at a time. The route already runs two tasks at
 * once; this stops a task that spans several repos from multiplying that.
 */
const FOLDER_CONCURRENCY = 1;

/** Byte counts of untracked files. Local reads, not git. */
const UNTRACKED_READ_CONCURRENCY = 4;

/** Paths shipped to the browser. Totals still count the rest. */
const LISTED_FILE_CAP = 200;

/** Untracked paths turned into file rows. Beyond this the total is a count. */
const UNTRACKED_OBJECT_CAP = 500;

/** Untracked files whose bytes we actually count. The rest stay in the total. */
const UNTRACKED_COUNT_CAP = 40;

/** Past this, an untracked file counts as a file and not as lines. */
const UNTRACKED_BYTE_CAP = 256_000;

/**
 * External diff drivers (git-lfs textconv) materialise blob contents just to
 * answer "how many lines". Cards never show the body, so the driver stays off.
 */
const STAT_ARGS = ['-z', '--find-renames', '--no-ext-diff', '--no-textconv'] as const;

const inflight = new Map<string, Promise<WorkspaceChangeSummary>>();

interface RepoRef {
  workspace: TaskWorkspace;
  branch?: string;
  /** Set when the folder is missing or not a repository. The git reads are skipped. */
  failure?: WorkspaceChangeSummary;
}

function pack(
  workspace: TaskWorkspace,
  files: ChangeFile[],
  opts: { truncated?: boolean; error?: string; branch?: string; baseRef?: string; extraFiles?: number } = {}
): WorkspaceChangeSummary {
  const extra = opts.extraFiles ?? 0;
  const out: WorkspaceChangeSummary = {
    cwd: workspace.cwd,
    label: workspace.label,
    stat: {
      files: files.length + extra,
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0)
    },
    files: filesForCard(files, LISTED_FILE_CAP),
    truncated: opts.truncated === true || extra > 0 || files.length > LISTED_FILE_CAP
  };
  if (opts.branch) out.branch = opts.branch;
  if (opts.baseRef) out.baseRef = opts.baseRef;
  if (opts.error) out.error = opts.error;
  return out;
}

function failed(workspace: TaskWorkspace, error: string, branch?: string): WorkspaceChangeSummary {
  return pack(workspace, [], { error, branch });
}

/** A file with no trailing newline is still one line, which is how a diff counts it. */
function lineCount(buf: Buffer): number {
  if (buf.length === 0) return 0;
  let lines = 0;
  for (const byte of buf) if (byte === 10) lines += 1;
  if (buf[buf.length - 1] !== 10) lines += 1;
  return lines;
}

async function countUntracked(cwd: string, relative: string): Promise<{ additions: number; binary: boolean; partial: boolean }> {
  const absolute = path.join(cwd, relative);
  let size = 0;
  try {
    const info = await fs.promises.stat(absolute);
    if (!info.isFile()) return { additions: 0, binary: false, partial: false };
    size = info.size;
  } catch {
    return { additions: 0, binary: false, partial: true };
  }
  if (size > UNTRACKED_BYTE_CAP) return { additions: 0, binary: false, partial: true };
  try {
    const body = await fs.promises.readFile(absolute);
    if (body.subarray(0, 8000).includes(0)) return { additions: 0, binary: true, partial: false };
    return { additions: lineCount(body), binary: false, partial: false };
  } catch {
    return { additions: 0, binary: false, partial: true };
  }
}

/** Tracked changes against `what` (`HEAD`, or `base...HEAD`). */
async function trackedFiles(cwd: string, what: string): Promise<ChangeFile[]> {
  const numstat = await runGit(cwd, ['diff', '--numstat', ...STAT_ARGS, what]);
  const nameStatus = await runGit(cwd, ['diff', '--name-status', ...STAT_ARGS, what]);
  return changeFilesFromStat(nameStatus, numstat);
}

async function untrackedFiles(cwd: string): Promise<{ files: ChangeFile[]; extra: number; partial: boolean }> {
  let listed = '';
  try {
    listed = await runGit(cwd, ['ls-files', '-z', '--others', '--exclude-standard']);
  } catch {
    return { files: [], extra: 0, partial: false };
  }
  const paths = listed.split('\0').filter(Boolean);
  const objects = paths.slice(0, UNTRACKED_OBJECT_CAP);
  const counted = await mapLimit(objects.slice(0, UNTRACKED_COUNT_CAP), UNTRACKED_READ_CONCURRENCY, (relative) =>
    countUntracked(cwd, relative)
  );
  const files = objects.map((relative, index) => {
    const count = counted[index];
    return {
      path: relative,
      status: 'added' as const,
      additions: count?.additions ?? 0,
      deletions: 0,
      binary: count?.binary ?? false
    };
  });
  return {
    files,
    extra: paths.length - objects.length,
    partial: paths.length > UNTRACKED_COUNT_CAP || counted.some((count) => count.partial)
  };
}

async function readAgainst(
  workspace: TaskWorkspace,
  what: string,
  branch?: string,
  baseRef?: string,
  withUntracked = false
): Promise<WorkspaceChangeSummary> {
  const tracked = await trackedFiles(workspace.cwd, what);
  const untracked = withUntracked ? await untrackedFiles(workspace.cwd) : { files: [], extra: 0, partial: false };
  return pack(workspace, [...tracked, ...untracked.files], {
    branch,
    baseRef,
    extraFiles: untracked.extra,
    truncated: untracked.partial
  });
}

/** One in-flight read per folder and comparison. A second task naming it waits. */
function loadAgainst(
  workspace: TaskWorkspace,
  what: string,
  branch?: string,
  baseRef?: string,
  withUntracked = false
): Promise<WorkspaceChangeSummary> {
  const key = `${workspace.cwd}\0${what}\0${withUntracked ? 'u' : ''}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const pending = readAgainst(workspace, what, branch, baseRef, withUntracked);
  inflight.set(key, pending);
  // The derived promise rejects when the read does. Callers observe `pending`;
  // this catch is only so the bookkeeping promise is not left unhandled.
  pending.finally(() => {
    if (inflight.get(key) === pending) inflight.delete(key);
  }).catch(() => undefined);
  return pending;
}

async function inspect(workspace: TaskWorkspace): Promise<RepoRef> {
  if (!workspace.cwd) return { workspace, failure: failed(workspace, 'No folder is associated with this task') };
  if (!fs.existsSync(workspace.cwd)) return { workspace, failure: failed(workspace, 'This folder no longer exists') };
  try {
    await runGit(workspace.cwd, ['rev-parse', '--is-inside-work-tree']);
    const branch = (await runGit(workspace.cwd, ['branch', '--show-current'])).trim() || undefined;
    return { workspace, branch };
  } catch {
    return { workspace, failure: failed(workspace, 'Not a git repository') };
  }
}

function hasChanges(reads: WorkspaceChangeSummary[]): boolean {
  return reads.some((workspace) => workspace.error) || sumDiffStats(reads.map((workspace) => workspace.stat)).files > 0;
}

/**
 * The dirty tree when any folder has one, otherwise what the branches add on
 * top of their bases. One scope for the whole task, so the card's label and
 * the rows under it describe the same read. Folders run one at a time.
 */
export async function summarizeTaskWorkspaces(workspaces: TaskWorkspace[]): Promise<TaskChangeSummary> {
  if (workspaces.length === 0) {
    const blank: TaskWorkspace = { cwd: '', label: '', isWorktree: false, isTaskFolder: true, sessionIds: [] };
    return { scope: 'uncommitted', workspaces: [failed(blank, 'No folder is associated with this task')] };
  }

  const repos = await mapLimit(workspaces, FOLDER_CONCURRENCY, inspect);
  const uncommitted = await mapLimit(repos, FOLDER_CONCURRENCY, (repo) => {
    if (repo.failure) return Promise.resolve(repo.failure);
    return loadAgainst(repo.workspace, 'HEAD', repo.branch, undefined, true).catch((e: unknown) =>
      failed(repo.workspace, e instanceof Error ? e.message : 'git diff failed', repo.branch)
    );
  });
  if (hasChanges(uncommitted)) return { scope: 'uncommitted', workspaces: uncommitted };

  const committed = await mapLimit(repos, FOLDER_CONCURRENCY, async (repo, index) => {
    if (repo.failure) return repo.failure;
    const baseRef = await resolveBaseRef(repo.workspace.cwd, repo.branch);
    if (!baseRef) return uncommitted[index]!;
    try {
      return await loadAgainst(repo.workspace, `${baseRef}...HEAD`, repo.branch, baseRef);
    } catch {
      return uncommitted[index]!;
    }
  });
  if (sumDiffStats(committed.map((workspace) => workspace.stat)).files > 0) {
    return { scope: 'branch', workspaces: committed };
  }
  return { scope: 'uncommitted', workspaces: uncommitted };
}
