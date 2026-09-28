/**
 * Unified-diff parsing, shared by the server (which shells out to `git diff`)
 * and the drawer's Changes tab. Kept pure so it can be tested without git.
 */

export type DiffLineKind = 'add' | 'del' | 'ctx' | 'meta';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  /** Line number in the pre-image, absent for additions. */
  oldLine?: number;
  /** Line number in the post-image, absent for deletions. */
  newLine?: number;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

/** How a path changed between the two trees. */
export type FileStatus = 'added' | 'deleted' | 'renamed' | 'modified';

export interface DiffFile {
  path: string;
  /** Previous path, only when `status` is `renamed`. */
  oldPath?: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  binary: boolean;
  hunks: DiffHunk[];
  /** True when the patch was dropped for exceeding the size budget. */
  truncated?: boolean;
}

export interface DiffStat {
  files: number;
  additions: number;
  deletions: number;
}

export function emptyDiffStat(): DiffStat {
  return { files: 0, additions: 0, deletions: 0 };
}

export function diffStat(files: DiffFile[]): DiffStat {
  return files.reduce<DiffStat>(
    (acc, file) => ({
      files: acc.files + 1,
      additions: acc.additions + file.additions,
      deletions: acc.deletions + file.deletions
    }),
    emptyDiffStat()
  );
}

/**
 * The totals across several folders. A task can work in more than one
 * repository, and the header over the Changes tab counts all of it — a file
 * changed in the API and a file changed in the app are two files changed.
 */
export function sumDiffStats(stats: DiffStat[]): DiffStat {
  return stats.reduce<DiffStat>(
    (acc, stat) => ({
      files: acc.files + stat.files,
      additions: acc.additions + stat.additions,
      deletions: acc.deletions + stat.deletions
    }),
    emptyDiffStat()
  );
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/** `a/src/App.tsx` -> `src/App.tsx`; leaves paths that lack the git prefix alone. */
function stripPrefix(raw: string): string {
  const path = unquote(raw.trim());
  return /^[ab]\//.test(path) ? path.slice(2) : path;
}

/** git quotes paths containing specials as C strings. */
function unquote(raw: string): string {
  if (!raw.startsWith('"') || !raw.endsWith('"') || raw.length < 2) return raw;
  return raw
    .slice(1, -1)
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function newFile(path: string): DiffFile {
  return { path, status: 'modified', additions: 0, deletions: 0, binary: false, hunks: [] };
}

/** Where the next line of each side lands, as a hunk is walked. */
interface LineCursor {
  old: number;
  new: number;
}

/**
 * The metadata lines that describe the file rather than its contents. Returns
 * true when the line was one of them; unknown ones are left for the caller to
 * ignore, so a future git version can't break the whole view.
 */
function readFileHeader(line: string, file: DiffFile): boolean {
  if (line.startsWith('--- ')) {
    const path = line.slice(4).trim();
    if (path !== '/dev/null') file.oldPath = stripPrefix(path);
    return true;
  }
  if (line.startsWith('+++ ')) {
    const path = line.slice(4).trim();
    if (path !== '/dev/null' && !file.path) file.path = stripPrefix(path);
    return true;
  }
  if (line.startsWith('new file mode')) {
    file.status = 'added';
    return true;
  }
  if (line.startsWith('deleted file mode')) {
    // The surviving name for a deletion is the a-side, patched in at the end.
    file.status = 'deleted';
    return true;
  }
  if (line.startsWith('rename from ')) {
    file.status = 'renamed';
    file.oldPath = stripPrefix(line.slice('rename from '.length));
    return true;
  }
  if (line.startsWith('rename to ')) {
    file.status = 'renamed';
    file.path = stripPrefix(line.slice('rename to '.length));
    return true;
  }
  if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) {
    file.binary = true;
    return true;
  }
  return false;
}

/**
 * One row inside a hunk, counted on the file and advanced on the cursor.
 *
 * Anything else is dropped — "\ No newline at end of file" belongs to the line
 * above it, not to a row of its own.
 */
function readHunkLine(line: string, file: DiffFile, hunk: DiffHunk, at: LineCursor): void {
  if (line.startsWith('+')) {
    file.additions++;
    hunk.lines.push({ kind: 'add', text: line.slice(1), newLine: at.new++ });
  } else if (line.startsWith('-')) {
    file.deletions++;
    hunk.lines.push({ kind: 'del', text: line.slice(1), oldLine: at.old++ });
  } else if (line.startsWith(' ')) {
    hunk.lines.push({ kind: 'ctx', text: line.slice(1), oldLine: at.old++, newLine: at.new++ });
  }
}

/**
 * Parses `git diff` output. Handles renames, binary files, mode-only changes and
 * multi-file patches. Unknown metadata lines are ignored rather than rejected so
 * a future git version can't break the whole view.
 */
export function parseUnifiedDiff(raw: string): DiffFile[] {
  if (!raw.trim()) return [];

  const files: DiffFile[] = [];
  let file: DiffFile | undefined;
  let hunk: DiffHunk | undefined;
  const at: LineCursor = { old: 0, new: 0 };

  const pushHunk = () => {
    if (file && hunk) file.hunks.push(hunk);
    hunk = undefined;
  };
  const pushFile = () => {
    pushHunk();
    if (file) files.push(file);
    file = undefined;
  };

  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git ')) {
      pushFile();
      // `diff --git a/x b/x` — take the b-side, which survives renames.
      const parts = splitGitPathPair(line.slice('diff --git '.length));
      file = newFile(stripPrefix(parts?.[1] ?? parts?.[0] ?? ''));
      continue;
    }
    if (!file) continue;
    if (readFileHeader(line, file)) continue;

    const match = HUNK_RE.exec(line);
    if (match) {
      pushHunk();
      at.old = Number(match[1]);
      at.new = Number(match[3]);
      hunk = { header: (match[5] || '').trim(), oldStart: at.old, newStart: at.new, lines: [] };
      continue;
    }

    if (hunk) readHunkLine(line, file, hunk, at);
  }
  pushFile();

  // A deletion's real path lives on the a-side; `diff --git` gave us the b-side.
  for (const entry of files) {
    if (entry.status === 'deleted' && entry.oldPath) entry.path = entry.oldPath;
  }
  return files;
}

/**
 * `a/x.ts b/x.ts` -> ['a/x.ts', 'b/x.ts'].
 * Paths may contain spaces, so prefer the quoted form and otherwise split on
 * the ` b/` boundary rather than on whitespace.
 */
function splitGitPathPair(rest: string): [string, string] | undefined {
  if (rest.startsWith('"')) {
    const end = findQuoteEnd(rest);
    if (end > 0) {
      const first = rest.slice(0, end + 1);
      const second = rest.slice(end + 1).trim();
      return [first, second];
    }
  }
  const boundary = rest.lastIndexOf(' b/');
  if (boundary > 0) return [rest.slice(0, boundary), rest.slice(boundary + 1)];
  const halves = rest.split(' ');
  return halves.length >= 2 ? [halves[0]!, halves[halves.length - 1]!] : undefined;
}

function findQuoteEnd(raw: string): number {
  for (let i = 1; i < raw.length; i++) {
    if (raw[i] === '\\') {
      i++;
      continue;
    }
    if (raw[i] === '"') return i;
  }
  return -1;
}

/** Short `+12 −3` style summary for a file row. */
export function fileStatLabel(file: DiffFile): string {
  if (file.binary) return 'binary';
  return `+${file.additions} −${file.deletions}`;
}

export const FILE_STATUS_LABEL: Record<FileStatus, string> = {
  added: 'added',
  deleted: 'deleted',
  renamed: 'renamed',
  modified: 'modified'
};
