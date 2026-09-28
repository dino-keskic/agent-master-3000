/**
 * `git diff -z --name-status` and `git diff -z --numstat` turned into the file
 * list a card counts.
 *
 * The patch body never comes along. A board that asked git for a full diff per
 * worktree spent its time parsing patches, and the counts were all a card
 * needed.
 */

import { ChangeFile } from './changeSummary.js';
import { FileStatus } from './diff.js';

interface LineCount {
  additions: number;
  deletions: number;
  binary: boolean;
  oldPath?: string;
}

/** One status record, in the order git printed it. */
interface StatusRecord {
  path: string;
  status: FileStatus;
  oldPath?: string;
}

function statusOf(code: string): FileStatus {
  // `R066` and `C100` carry a similarity score after the letter.
  const kind = code[0];
  if (kind === 'A') return 'added';
  if (kind === 'D') return 'deleted';
  if (kind === 'R') return 'renamed';
  // A copy is a new path. The source is still there, so it is not a rename.
  if (kind === 'C') return 'added';
  return 'modified';
}

/** `git diff -z --name-status`. Renames and copies occupy two path fields. */
export function parseNameStatusZ(raw: string): StatusRecord[] {
  const parts = raw.split('\0');
  const records: StatusRecord[] = [];
  let i = 0;
  while (i < parts.length) {
    const code = parts[i];
    if (!code) break;
    const kind = code[0];
    if (kind === 'R' || kind === 'C') {
      const oldPath = parts[i + 1];
      const path = parts[i + 2];
      if (!path) break;
      const record: StatusRecord = { path, status: statusOf(code) };
      if (kind === 'R' && oldPath) record.oldPath = oldPath;
      records.push(record);
      i += 3;
      continue;
    }
    const path = parts[i + 1];
    if (!path) break;
    records.push({ path, status: statusOf(code) });
    i += 2;
  }
  return records;
}

/**
 * `git diff -z --numstat`.
 *
 * A rename is `added \t deleted \t \0 old \0 new \0` — the path field is empty
 * and the two paths follow as their own NUL-terminated fields. Anything else
 * is `added \t deleted \t path \0`. Binary files use `-` for both counts.
 */
export function parseNumstatZ(raw: string): Map<string, LineCount> {
  const byPath = new Map<string, LineCount>();
  let i = 0;
  while (i < raw.length) {
    const end = raw.indexOf('\0', i);
    if (end < 0) break;
    const record = raw.slice(i, end);
    i = end + 1;
    const tab1 = record.indexOf('\t');
    const tab2 = tab1 < 0 ? -1 : record.indexOf('\t', tab1 + 1);
    if (tab1 < 0 || tab2 < 0) continue;
    const addRaw = record.slice(0, tab1);
    const delRaw = record.slice(tab1 + 1, tab2);
    const binary = addRaw === '-' || delRaw === '-';
    const additions = binary ? 0 : Number(addRaw);
    const deletions = binary ? 0 : Number(delRaw);
    if (!Number.isFinite(additions) || !Number.isFinite(deletions)) continue;

    let path = record.slice(tab2 + 1);
    let oldPath: string | undefined;
    if (path === '') {
      const endOld = raw.indexOf('\0', i);
      if (endOld < 0) break;
      const endNew = raw.indexOf('\0', endOld + 1);
      if (endNew < 0) break;
      oldPath = raw.slice(i, endOld);
      path = raw.slice(endOld + 1, endNew);
      i = endNew + 1;
    }
    if (!path) continue;
    const count: LineCount = { additions, deletions, binary };
    if (oldPath) count.oldPath = oldPath;
    byPath.set(path, count);
  }
  return byPath;
}

/** Join a name-status stream and a numstat stream on the new path. */
export function changeFilesFromStat(nameStatusZ: string, numstatZ: string): ChangeFile[] {
  const counts = parseNumstatZ(numstatZ);
  const seen = new Set<string>();
  const files: ChangeFile[] = [];

  for (const hit of parseNameStatusZ(nameStatusZ)) {
    seen.add(hit.path);
    const count = counts.get(hit.path);
    const file: ChangeFile = {
      path: hit.path,
      status: hit.status,
      additions: count?.additions ?? 0,
      deletions: count?.deletions ?? 0,
      binary: count?.binary ?? false
    };
    const oldPath = hit.oldPath || count?.oldPath;
    if (hit.status === 'renamed' && oldPath) file.oldPath = oldPath;
    files.push(file);
  }

  for (const [path, count] of counts) {
    if (seen.has(path)) continue;
    const status: FileStatus = count.oldPath ? 'renamed' : 'modified';
    const file: ChangeFile = {
      path,
      status,
      additions: count.additions,
      deletions: count.deletions,
      binary: count.binary
    };
    if (status === 'renamed' && count.oldPath) file.oldPath = count.oldPath;
    files.push(file);
  }
  return files;
}
