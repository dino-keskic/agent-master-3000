import { DiffFile, DiffLine } from '../git/diff.js';
import { ChangelogComment } from '../types.js';

/**
 * Where a review note is being written.
 *
 * A note is anchored to a line of a diff, and a line is only identified by the
 * pair of numbers it has on either side of the change — an addition has no old
 * number, a deletion no new one. Everything here is about naming that spot
 * precisely enough that the draft box appears on one row and nowhere else.
 */

export interface DraftTarget {
  path: string;
  /** The folder the file is in, when the task works in more than one. */
  cwd?: string;
  newLine?: number;
  oldLine?: number;
  side: ChangelogComment['side'];
  snippet: string;
}

/**
 * Identity of a draft's anchor. The side is part of it: an addition and the
 * deletion it replaced can share a line number, and are still two rows.
 */
export function draftKey(target: DraftTarget): string {
  // The folder leads: the same path in two checkouts is two rows, and a click
  // on one of them must not open the draft box on both.
  const file = `${target.cwd || ''}:${target.path}`;
  if (target.side === 'file') return `${file}:file`;
  return `${file}:${target.newLine ?? ''}:${target.oldLine ?? ''}:${target.side}`;
}

/** The draft a click on one diff line opens, quoting the line it anchors to. */
export function lineDraft(path: string, line: DiffLine, cwd?: string): DraftTarget {
  const marker = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' ';
  return {
    path,
    cwd,
    newLine: line.newLine,
    oldLine: line.oldLine,
    side: line.kind === 'add' || line.kind === 'del' || line.kind === 'ctx' ? line.kind : 'ctx',
    snippet: `${marker}${line.text}`
  };
}

/** Jump the editor to the first real change rather than the top of the file. */
export function firstChangedLine(file: DiffFile): number | undefined {
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === 'add' && line.newLine) return line.newLine;
      if (line.kind === 'del' && line.oldLine) return line.oldLine;
    }
  }
  return undefined;
}
