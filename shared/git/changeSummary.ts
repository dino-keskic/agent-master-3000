/**
 * The computed change summary a board card shows: what the working tree (or
 * the branch) actually contains, rather than the agent's prose about it.
 *
 * The server reads this from `git diff` via `server/git/diff.ts` and strips the
 * hunks before transport — a card needs counts and paths, never patch bodies.
 * What is here is the transport shape, the hunk-stripping, and the digest a
 * card renders: totals, per-status counts, and flags for the paths a reviewer
 * triages on (dependencies, lockfiles, migrations, config, CI).
 */

import { DiffFile, DiffStat, FileStatus } from './diff.js';

/** Which tree a summary was read from. Mirrors the Changes tab scopes. */
export type ChangeScope = 'uncommitted' | 'branch';

/** A changed file with the patch body left behind. */
export interface ChangeFile {
  path: string;
  /** Previous path, only when `status` is `renamed`. */
  oldPath?: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  binary: boolean;
}

/** One folder of a task, with what changed in it. */
export interface WorkspaceChangeSummary {
  cwd: string;
  label: string;
  /** Branch the working tree is on, when known. */
  branch?: string;
  /** What `branch` scope compared against, e.g. `main`. */
  baseRef?: string;
  stat: DiffStat;
  files: ChangeFile[];
  /** Set when the underlying diff hit the read cap and files are missing. */
  truncated: boolean;
  /** Populated instead of `files` when the folder is gone or git failed. */
  error?: string;
}

/** What a task changed, in every folder it works in. */
export interface TaskChangeSummary {
  scope: ChangeScope;
  workspaces: WorkspaceChangeSummary[];
}

/** Drop the hunks: a card counts lines, it never shows them. */
export function toChangeFile(file: DiffFile): ChangeFile {
  const out: ChangeFile = {
    path: file.path,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    binary: file.binary
  };
  // The parser leaves the a-side path on every file; only a rename needs it.
  // A deletion's path was already patched to it, and anything else would just
  // ship the same path twice per file.
  if (file.status === 'renamed' && file.oldPath) out.oldPath = file.oldPath;
  return out;
}

/**
 * Strip a full diff down to its summary. The input is structural rather than
 * `server/git/diff.ts`'s `TaskDiff` so this module keeps its no-`server`
 * direction: the server hands over a diff, this hands back a summary.
 */
export function toWorkspaceChangeSummary(
  diff: {
    branch?: string;
    baseRef?: string;
    stat: DiffStat;
    files: DiffFile[];
    truncated: boolean;
    error?: string;
  },
  meta: { cwd: string; label: string }
): WorkspaceChangeSummary {
  const out: WorkspaceChangeSummary = {
    cwd: meta.cwd,
    label: meta.label,
    stat: diff.stat,
    files: diff.files.map(toChangeFile),
    truncated: diff.truncated
  };
  if (diff.branch) out.branch = diff.branch;
  if (diff.baseRef) out.baseRef = diff.baseRef;
  if (diff.error) out.error = diff.error;
  return out;
}

/**
 * The paths a reviewer triages on. Deliberately a small, explainable set —
 * every flag here answers "should I look closer before trusting this card".
 */
export type ChangeFlag = 'deps' | 'lockfile' | 'migration' | 'config' | 'ci';

export const CHANGE_FLAG_LABEL: Record<ChangeFlag, string> = {
  deps: 'deps',
  lockfile: 'lockfile',
  migration: 'migration',
  config: 'config',
  ci: 'ci'
};

/** Display order. Discovery order would reshuffle the chips on every refresh. */
const FLAG_ORDER: ChangeFlag[] = ['deps', 'lockfile', 'migration', 'config', 'ci'];

const LOCKFILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'Cargo.lock',
  'Gemfile.lock',
  'poetry.lock',
  'uv.lock',
  'composer.lock',
  'go.sum',
  'Podfile.lock',
  'Package.resolved'
]);

const DEP_MANIFESTS = new Set([
  'package.json',
  'Cargo.toml',
  'pyproject.toml',
  'go.mod',
  'Gemfile',
  'composer.json',
  'Package.swift',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts'
]);

const CI_FILES = new Set(['.gitlab-ci.yml', '.travis.yml', 'Jenkinsfile']);

function basename(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
}

/** `requirements.txt`, `requirements-dev.txt`, and the like. */
function isRequirementsFile(name: string): boolean {
  return name === 'requirements.txt' || (name.startsWith('requirements-') && name.endsWith('.txt'));
}

function isConfigFile(name: string): boolean {
  if (name === 'Dockerfile' || name.startsWith('Dockerfile.') || name.startsWith('docker-compose.')) return true;
  if (name === '.env' || name.startsWith('.env.')) return true;
  return (
    name.endsWith('.config.js') ||
    name.endsWith('.config.cjs') ||
    name.endsWith('.config.mjs') ||
    name.endsWith('.config.ts')
  );
}

/** Flags for one path. A path can raise several: a lockfile is never deps. */
export function flagsForPath(path: string): ChangeFlag[] {
  const name = basename(path);
  const segments = path.toLowerCase().split('/');
  const flags = new Set<ChangeFlag>();
  if (LOCKFILES.has(name)) flags.add('lockfile');
  else if (DEP_MANIFESTS.has(name) || isRequirementsFile(name)) flags.add('deps');
  if (segments.some((segment) => segment.includes('migrat'))) flags.add('migration');
  if (isConfigFile(name)) flags.add('config');
  if (
    CI_FILES.has(name) ||
    (segments[0] === '.github' && segments[1] === 'workflows') ||
    segments[0] === '.circleci' ||
    segments[0] === '.buildkite'
  ) {
    flags.add('ci');
  }
  return FLAG_ORDER.filter((flag) => flags.has(flag));
}

/**
 * The files a card can carry. Flagged paths stay even when the list is longer
 * than `cap`, because a lockfile past the cut would otherwise vanish from the
 * chips while the totals still counted it.
 */
export function filesForCard(files: ChangeFile[], cap: number): ChangeFile[] {
  if (files.length <= cap) return files;
  const flagged: ChangeFile[] = [];
  const rest: ChangeFile[] = [];
  for (const file of files) {
    if (flagsForPath(file.path).length > 0) flagged.push(file);
    else rest.push(file);
  }
  return [...flagged, ...rest].slice(0, cap);
}

/** Everything a card renders, across every folder of the task. */
export interface ChangeDigest {
  files: number;
  additions: number;
  deletions: number;
  added: number;
  deleted: number;
  renamed: number;
  flags: ChangeFlag[];
}

export function emptyChangeDigest(): ChangeDigest {
  return { files: 0, additions: 0, deletions: 0, added: 0, deleted: 0, renamed: 0, flags: [] };
}

export function summarizeChanges(summary: TaskChangeSummary): ChangeDigest {
  const digest = emptyChangeDigest();
  const flags = new Set<ChangeFlag>();
  for (const workspace of summary.workspaces) {
    if (workspace.error) continue;
    digest.files += workspace.stat.files;
    digest.additions += workspace.stat.additions;
    digest.deletions += workspace.stat.deletions;
    for (const file of workspace.files) {
      if (file.status === 'added') digest.added++;
      else if (file.status === 'deleted') digest.deleted++;
      else if (file.status === 'renamed') digest.renamed++;
      for (const flag of flagsForPath(file.path)) flags.add(flag);
    }
  }
  digest.flags = FLAG_ORDER.filter((flag) => flags.has(flag));
  return digest;
}

/**
 * How many files the Changes tab's badge counts: the live summary the board
 * fetched, or, before that has arrived (or for a task it did not fetch), what
 * was recorded when the last turn ended.
 */
export function changedFileCount(
  summary: TaskChangeSummary | undefined,
  recorded: { files: number } | undefined
): number {
  if (summary) return summarizeChanges(summary).files;
  return recorded?.files || 0;
}

/**
 * `+128 −34 · 6 files` — the compact stat line. Counts of new and deleted
 * files ride in the row's tooltip instead: the strip is narrow, and the totals
 * are what triage reads.
 */
export function formatChangeDigest(digest: ChangeDigest): string {
  return `+${digest.additions} −${digest.deletions} · ${digest.files} ${digest.files === 1 ? 'file' : 'files'}`;
}

/** `2 new, 1 deleted` for the tooltip, or undefined when nothing stands out. */
export function changeDetailLabel(digest: ChangeDigest): string | undefined {
  const parts: string[] = [];
  if (digest.added > 0) parts.push(`${digest.added} new`);
  if (digest.deleted > 0) parts.push(`${digest.deleted} deleted`);
  if (digest.renamed > 0) parts.push(`${digest.renamed} renamed`);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/** Where the numbers came from, for the tooltip. */
export function changeScopeLabel(summary: TaskChangeSummary): string {
  if (summary.scope === 'uncommitted') return 'Uncommitted changes';
  const lead = summary.workspaces.find((workspace) => !workspace.error);
  if (lead?.branch && lead.baseRef) return `On ${lead.branch} vs ${lead.baseRef}`;
  if (lead?.branch) return `Committed on ${lead.branch}`;
  return 'Committed on the branch';
}

/**
 * The summaries for the ids on screen. Entries for tasks that left (archived,
 * filtered out) are dropped; when nothing left, the same reference comes
 * back, so memoised cards don't re-render on an id-set change that kept them.
 */
export function visibleChangeSummaries(
  summaries: Record<string, TaskChangeSummary>,
  ids: string[]
): Record<string, TaskChangeSummary> {
  const wanted = new Set(ids);
  if (Object.keys(summaries).every((id) => wanted.has(id))) return summaries;
  const visible: Record<string, TaskChangeSummary> = {};
  for (const [id, summary] of Object.entries(summaries)) {
    if (wanted.has(id)) visible[id] = summary;
  }
  return visible;
}

/**
 * Fold a fresh fetch into the board's summaries. Tasks whose summary is
 * unchanged keep their object identity, so memoised cards don't re-render —
 * the fetch refreshes while turns run, and most cards are idle.
 */
export function mergeChangeSummaries(
  prev: Record<string, TaskChangeSummary>,
  next: Record<string, TaskChangeSummary>
): Record<string, TaskChangeSummary> {
  const merged: Record<string, TaskChangeSummary> = {};
  let changed = Object.keys(prev).length !== Object.keys(next).length;
  for (const [id, summary] of Object.entries(next)) {
    const old = prev[id];
    if (old && JSON.stringify(old) === JSON.stringify(summary)) {
      merged[id] = old;
    } else {
      merged[id] = summary;
      changed = true;
    }
  }
  return changed ? merged : prev;
}
