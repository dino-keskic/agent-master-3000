import { execFile } from 'child_process';
import fs from 'fs';
import { promisify } from 'util';
import { DiffFile, DiffStat, diffStat, parseUnifiedDiff } from '../../shared/git/diff.js';

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
      raw = await runGit(cwd, ['diff', '--no-color', '--find-renames', 'HEAD']);
      raw += await untrackedDiff(cwd);
    }
  } catch (e: any) {
    if (e?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || /maxBuffer/i.test(e?.message || '')) {
      truncated = true;
      raw = e?.stdout || '';
    } else {
      return { ...emptyDiff(scope, cwd), isRepo: true, branch, error: e?.message || 'git diff failed' };
    }
  }

  const files = parseUnifiedDiff(raw).map(capFile);
  return { scope, isRepo: true, cwd, branch, baseRef, files, stat: diffStat(files), truncated };
}

/** Renders untracked files as synthetic "new file" patches. */
async function untrackedDiff(cwd: string): Promise<string> {
  let listed = '';
  try {
    listed = await runGit(cwd, ['ls-files', '--others', '--exclude-standard', '-z']);
  } catch {
    return '';
  }
  const paths = listed.split('\0').filter(Boolean);
  let out = '';
  for (const relative of paths.slice(0, 200)) {
    try {
      // `--no-index` against /dev/null gives us a real patch for a new file.
      out += await runGit(cwd, ['diff', '--no-color', '--no-index', '--', '/dev/null', relative]);
    } catch (e: any) {
      // --no-index exits 1 when files differ, which is the normal case here.
      if (typeof e?.stdout === 'string') out += e.stdout;
    }
  }
  return out;
}

/** Drops the body of pathologically large patches but keeps the file row. */
function capFile(file: DiffFile): DiffFile {
  const lines = file.hunks.reduce((n, hunk) => n + hunk.lines.length, 0);
  if (lines <= MAX_FILE_LINES) return file;
  return { ...file, hunks: [], truncated: true };
}
