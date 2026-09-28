import { DiffFile, DiffHunk, DiffLine, parseUnifiedDiff } from '../git/diff.js';
import { toolKind } from './toolCall.js';
import { ToolCallInfo } from '../types.js';

/**
 * The diff an edit tool call is actually describing. An agent's `edit` arrives
 * as `{ filePath, oldString, newString }` and its output says only "Edit
 * applied successfully", so the change itself has to be reconstructed here;
 * `apply_patch` already carries a unified diff, and `write` carries a whole new
 * file. All three come out in the `DiffFile`/`DiffHunk`/`DiffLine` shapes from
 * `diff.ts`, so the transcript and the Changes tab can share one renderer.
 *
 * Pure: no fs, no React, no git. What belongs here is the decision of *what
 * diff to show*; how it looks belongs in `src/components/stream/toolCall/`.
 */

export interface EditDiff {
  files: DiffFile[];
  /** True when a cap dropped input lines or hunk rows from what is shown. */
  truncated: boolean;
}

/** Lines of context kept either side of a change, matching `git diff`'s default. */
const CONTEXT = 3;

/*
 * Why the caps are where they are.
 *
 * The line differ below is a plain LCS: O(n·m) in both time and memory, with
 * one Uint32Array cell per pair of lines. At MAX_SIDE_LINES = 1200 that is
 * ~1.4M cells (~5.8 MB) and a few milliseconds — fine to run inside a render.
 * A 10,000-line replacement would be 100M cells (400 MB) and seconds of work,
 * which is a locked tab, so the input is cut before it ever reaches the differ.
 * MAX_SIDE_CHARS catches the other shape of the same problem: few lines, each
 * of them a megabyte of minified output.
 *
 * MAX_ROWS is separate and about the DOM, not the algorithm — a transcript
 * shows a diff inline, and past a few hundred rows scrolling costs more than
 * the diff is worth. Anything cut sets `truncated`, and the raw JSON stays
 * reachable underneath for the cases where someone needs all of it.
 */
const MAX_SIDE_LINES = 1200;
const MAX_SIDE_CHARS = 100_000;
const MAX_ROWS = 800;

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Only edit-family calls get a diff; everything else keeps its JSON body. */
function isEditCall(info: ToolCallInfo): boolean {
  return toolKind(info.name) === 'edit' || (info.kind || '').toLowerCase() === 'edit';
}

function editPath(info: ToolCallInfo): string {
  const input = info.rawInput || {};
  return (
    asString(input.filePath) ||
    asString(input.path) ||
    info.locations?.[0] ||
    'file'
  );
}

/**
 * A trailing newline terminates the last line, it does not start an empty one,
 * so `"a\nb\n"` is two lines and `""` is none.
 */
function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Cuts one side down to what the differ can chew, reporting whether it had to. */
function capInput(lines: string[]): { lines: string[]; truncated: boolean } {
  let chars = 0;
  const out: string[] = [];
  for (const line of lines) {
    if (out.length >= MAX_SIDE_LINES || chars + line.length > MAX_SIDE_CHARS) {
      return { lines: out, truncated: true };
    }
    out.push(line);
    chars += line.length + 1;
  }
  return { lines: out, truncated: false };
}

type Op = { kind: 'ctx' | 'add' | 'del'; text: string };

/**
 * Longest-common-subsequence line diff. `dp[i][j]` is the length of the LCS of
 * `a[i..]` and `b[j..]`, filled from the end so the walk forward reads in file
 * order. On a tie the deletion is emitted first, which is how a hunk is
 * conventionally written and what makes a replaced line read as `-` then `+`.
 */
function diffLines(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const dp = new Uint32Array((n + 1) * width);

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] =
        a[i] === b[j]
          ? dp[(i + 1) * width + j + 1]! + 1
          : Math.max(dp[(i + 1) * width + j]!, dp[i * width + j + 1]!);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'ctx', text: a[i]! });
      i++;
      j++;
    } else if (dp[(i + 1) * width + j]! >= dp[i * width + j + 1]!) {
      ops.push({ kind: 'del', text: a[i]! });
      i++;
    } else {
      ops.push({ kind: 'add', text: b[j]! });
      j++;
    }
  }
  while (i < n) ops.push({ kind: 'del', text: a[i++]! });
  while (j < m) ops.push({ kind: 'add', text: b[j++]! });
  return ops;
}

/** Numbers the ops on both sides, starting from the given 1-based line. */
function numberOps(ops: Op[], firstOld: number, firstNew: number): DiffLine[] {
  let oldLine = firstOld;
  let newLine = firstNew;
  return ops.map((op) => {
    if (op.kind === 'add') return { kind: 'add', text: op.text, newLine: newLine++ };
    if (op.kind === 'del') return { kind: 'del', text: op.text, oldLine: oldLine++ };
    return { kind: 'ctx', text: op.text, oldLine: oldLine++, newLine: newLine++ };
  });
}

/**
 * Groups changed lines into hunks with `CONTEXT` lines either side. Two changes
 * separated by at most `2 * CONTEXT` unchanged lines share a hunk, because
 * splitting them would print the same context twice.
 */
function toHunks(lines: DiffLine[]): DiffHunk[] {
  const changed = lines.map((line) => line.kind === 'add' || line.kind === 'del');
  const hunks: DiffHunk[] = [];

  let i = 0;
  while (i < lines.length) {
    if (!changed[i]) {
      i++;
      continue;
    }
    const start = Math.max(0, i - CONTEXT);
    let end = i;
    let scan = i;
    for (;;) {
      while (scan < lines.length && changed[scan]) end = scan++;
      let ahead = scan;
      while (ahead < lines.length && !changed[ahead] && ahead - scan < 2 * CONTEXT) ahead++;
      if (ahead < lines.length && changed[ahead]) {
        scan = ahead;
        continue;
      }
      break;
    }
    const stop = Math.min(lines.length - 1, end + CONTEXT);
    hunks.push(makeHunk(lines.slice(start, stop + 1)));
    i = stop + 1;
  }
  return hunks;
}

function makeHunk(lines: DiffLine[]): DiffHunk {
  return {
    header: '',
    oldStart: lines.find((line) => line.oldLine !== undefined)?.oldLine ?? 0,
    newStart: lines.find((line) => line.newLine !== undefined)?.newLine ?? 0,
    lines
  };
}

/** Keeps whole hunks until the row budget runs out, so no hunk ends mid-change. */
function capRows(hunks: DiffHunk[]): { hunks: DiffHunk[]; truncated: boolean } {
  const kept: DiffHunk[] = [];
  let rows = 0;
  for (const hunk of hunks) {
    if (rows + hunk.lines.length > MAX_ROWS) {
      // Always show something: a first hunk over budget is cut mid-way rather
      // than dropped, or a single huge change would render as nothing at all.
      if (kept.length === 0) kept.push({ ...hunk, lines: hunk.lines.slice(0, MAX_ROWS) });
      return { hunks: kept, truncated: true };
    }
    kept.push(hunk);
    rows += hunk.lines.length;
  }
  return { hunks: kept, truncated: false };
}

function countKinds(lines: DiffLine[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.kind === 'add') additions++;
    else if (line.kind === 'del') deletions++;
  }
  return { additions, deletions };
}

/**
 * A replacement, diffed on its own. The tool call carries the two snippets but
 * not the file they sit in, so there is nothing to anchor them to: the line
 * numbers are 1-based within the replaced text, not within the file. Whether
 * `oldString` occurs once or ten times in the file makes no difference here —
 * matching it is the agent's job, and already done by the time we see this.
 */
function fromStrings(path: string, oldText: string, newText: string): EditDiff | null {
  const oldSide = capInput(splitLines(oldText));
  const newSide = capInput(splitLines(newText));
  const lines = numberOps(diffLines(oldSide.lines, newSide.lines), 1, 1);
  const counts = countKinds(lines);
  if (counts.additions === 0 && counts.deletions === 0) return null;

  const capped = capRows(toHunks(lines));
  const truncated = oldSide.truncated || newSide.truncated || capped.truncated;
  return {
    files: [
      {
        path,
        status: oldText === '' ? 'added' : 'modified',
        additions: counts.additions,
        deletions: counts.deletions,
        binary: false,
        hunks: capped.hunks,
        truncated
      }
    ],
    truncated
  };
}

/** `write`: no pre-image, so every line is an addition. */
function fromNewFile(path: string, content: string): EditDiff | null {
  const side = capInput(splitLines(content));
  if (side.lines.length === 0) return null;
  const lines: DiffLine[] = side.lines.map((text, index) => ({
    kind: 'add',
    text,
    newLine: index + 1
  }));
  const capped = capRows([makeHunk(lines)]);
  const truncated = side.truncated || capped.truncated;
  return {
    files: [
      {
        path,
        status: 'added',
        additions: lines.length,
        deletions: 0,
        binary: false,
        hunks: capped.hunks,
        truncated
      }
    ],
    truncated
  };
}

/** `apply_patch`: already a unified diff, so reuse the parser rather than guess. */
function fromPatch(patchText: string): EditDiff | null {
  const files = parseUnifiedDiff(patchText).filter(
    (file) => file.hunks.length > 0 || file.binary
  );
  if (files.length === 0) return null;

  let truncated = false;
  const capped = files.map((file) => {
    const result = capRows(file.hunks);
    truncated = truncated || result.truncated;
    return result.truncated ? { ...file, hunks: result.hunks, truncated: true } : file;
  });
  return { files: capped, truncated };
}

/**
 * The diff to show for a tool call, or null when there is nothing better than
 * the raw JSON — a non-edit tool, an input shape we do not recognise, or an
 * edit that changed nothing.
 */
export function editDiff(info: ToolCallInfo): EditDiff | null {
  if (!isEditCall(info)) return null;
  const input = info.rawInput;
  if (!input) return null;

  const patch = asString(input.patchText);
  if (patch !== undefined) return patch.trim() ? fromPatch(patch) : null;

  const oldText = asString(input.oldString);
  const newText = asString(input.newString);
  if (oldText !== undefined && newText !== undefined) {
    return fromStrings(editPath(info), oldText, newText);
  }

  // `write` sends the whole file; some agents spell the same thing `newString`.
  const content = asString(input.content) ?? newText;
  if (content !== undefined) return fromNewFile(editPath(info), content);

  return null;
}
