import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { DiffFile, DiffStat, addedFileDiff, diffStat, parseUnifiedDiff } from '../../shared/git/diff.js';

const execFileAsync = promisify(execFile);

/**
 * A single agent turn can rewrite a lockfile. Cap what we read so a 40MB patch
 * can't wedge the server or the browser.
 */
const MAX_DIFF_BYTES = 4_000_000;
const MAX_FILE_LINES = 4_000;

export type DiffScope = 'uncommitted' | 'branch';

export interface TaskDiff {
  scope: DiffScope;
  isRepo: boolean;
  cwd: string;
  /** Branch the working tree is on, when known. */
  branch?: string;
  /** What `branch` scope compared against, e.g. `main`. */
  baseRef?: string;
  files: DiffFile[];
  stat: DiffStat;
  /** Set when output hit MAX_DIFF_BYTES and files are missing. */
  truncated: boolean;
  /** Populated instead of `files` when the folder is gone or git failed. */
  error?: string;
}

/** One git invocation, capped so a huge patch cannot fill memory. */
export async function runGit(cwd: string, args: string[], timeout = 20_000): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout,
    encoding: 'utf8',
    maxBuffer: MAX_DIFF_BYTES
  });
  return stdout;
}

function emptyDiff(scope: DiffScope, cwd: string, error?: string): TaskDiff {
  return { scope, isRepo: false, cwd, files: [], stat: { files: 0, additions: 0, deletions: 0 }, truncated: false, error };
}

/** First of these that exists is what `branch` scope diffs against. */
const BASE_CANDIDATES = ['origin/HEAD', 'origin/main', 'origin/master', 'main', 'master'];

export async function resolveBaseRef(cwd: string, branch?: string): Promise<string | undefined> {
  for (const candidate of BASE_CANDIDATES) {
    try {
      await runGit(cwd, ['rev-parse', '--verify', '--quiet', candidate]);
    } catch {
      continue;
    }
    // Diffing a branch against itself yields nothing. The remote-tracking form
    // is kept: on `master`, `origin/master...HEAD` is the unpushed work.
    if (branch && candidate === branch) continue;
    return candidate;
  }
  return undefined;
}

/**
 * Working-tree changes (`uncommitted`) or everything this branch adds on top of
 * its base (`branch`). Untracked files are included in `uncommitted` via
 * `--intent-to-add`-style probing so newly written files show up.
 */
export async function taskDiff(cwd: string, scope: DiffScope = 'uncommitted'): Promise<TaskDiff> {
  if (!cwd) return emptyDiff(scope, cwd, 'No folder is associated with this task');
  if (!fs.existsSync(cwd)) return emptyDiff(scope, cwd, 'This folder no longer exists');

  let branch: string | undefined;
  try {
    await runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
    branch = (await runGit(cwd, ['branch', '--show-current'])).trim() || undefined;
  } catch {
    return emptyDiff(scope, cwd, 'Not a git repository');
  }

  let raw = '';
  let untracked: { files: DiffFile[]; truncated: boolean } = { files: [], truncated: false };
  let truncated = false;
  let baseRef: string | undefined;

  try {
    if (scope === 'branch') {
      baseRef = await resolveBaseRef(cwd, branch);
      if (!baseRef) {
        return { ...emptyDiff(scope, cwd), isRepo: true, branch, error: 'No base branch found to compare against' };
      }
      raw = await runGit(cwd, ['diff', '--no-color', '--find-renames', `${baseRef}...HEAD`]);
    } else {
      // Tracked edits first, then untracked files rendered as additions.
      [raw, untracked] = await Promise.all([
        runGit(cwd, ['diff', '--no-color', '--find-renames', 'HEAD']),
        untrackedFiles(cwd)
      ]);
    }
  } catch (e: any) {
    if (e?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || /maxBuffer/i.test(e?.message || '')) {
      truncated = true;
      raw = e?.stdout || '';
    } else {
      return { ...emptyDiff(scope, cwd), isRepo: true, branch, error: e?.message || 'git diff failed' };
    }
  }

  const files = [...parseUnifiedDiff(raw), ...untracked.files].map(capFile);
  truncated ||= untracked.truncated;
  return { scope, isRepo: true, cwd, branch, baseRef, files, stat: diffStat(files), truncated };
}

/** Untracked files past this many are left off the list. */
const MAX_UNTRACKED_FILES = 200;
/** git's own test for binary: a NUL byte in the first 8000. */
const BINARY_SNIFF_BYTES = 8_000;

/**
 * Untracked files, rendered as additions. They are read from disk rather than
 * asked of git one `diff --no-index` at a time: that was a process per file,
 * about a tenth of a second each in a large checkout, so a turn that wrote a
 * dozen files made the tab wait more than a second for them alone.
 */
async function untrackedFiles(cwd: string): Promise<{ files: DiffFile[]; truncated: boolean }> {
  let listed = '';
  try {
    listed = await runGit(cwd, ['ls-files', '--others', '--exclude-standard', '-z']);
  } catch {
    return { files: [], truncated: false };
  }
  const paths = listed.split('\0').filter(Boolean).slice(0, MAX_UNTRACKED_FILES);
  const read = (await Promise.all(paths.map((relative) => readUntracked(cwd, relative))))
    .filter((entry) => entry !== undefined);
  // The same budget git's output had: past it, the rest are rows with no body.
  let budget = MAX_DIFF_BYTES;
  let truncated = false;
  const files = read.map(({ relative, content, size }) => {
    if (content === undefined || size > budget) {
      truncated = true;
      return { ...addedFileDiff(relative, ''), truncated: true };
    }
    budget -= size;
    return addedFileDiff(relative, content);
  });
  return { files, truncated };
}

interface UntrackedRead {
  relative: string;
  /** Null for a binary file; undefined when it was too big to read. */
  content: string | null | undefined;
  size: number;
}

/** One untracked file's text, or nothing when it is gone. A link shows its target, as git does. */
async function readUntracked(cwd: string, relative: string): Promise<UntrackedRead | undefined> {
  const full = path.join(cwd, relative);
  try {
    const stat = await fs.promises.lstat(full);
    if (stat.isSymbolicLink()) {
      const target = await fs.promises.readlink(full);
      return { relative, content: target, size: target.length };
    }
    if (!stat.isFile()) return { relative, content: '', size: 0 };
    if (stat.size > MAX_DIFF_BYTES) return { relative, content: undefined, size: stat.size };
    const bytes = await fs.promises.readFile(full);
    const binary = bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0);
    return { relative, content: binary ? null : bytes.toString('utf8'), size: binary ? 0 : bytes.length };
  } catch {
    // Gone between the listing and the read: it is not a change any more.
    return undefined;
  }
}

/** Drops the body of pathologically large patches but keeps the file row. */
function capFile(file: DiffFile): DiffFile {
  const lines = file.hunks.reduce((n, hunk) => n + hunk.lines.length, 0);
  if (lines <= MAX_FILE_LINES) return file;
  return { ...file, hunks: [], truncated: true };
}
