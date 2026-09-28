/**
 * Naming and placing a worktree.
 *
 * Two things a checkout is judged by: whether its name says what the work is,
 * and whether the folder it lands in is one everything else can reach. A ticket
 * answers the first outright — `WEB-1234` is the name the work already has
 * everywhere else — so it wins over anything guessed from the prompt.
 */

/** Branch/folder name for a new worktree, derived from the first prompt line. */
export function worktreeSlug(source: string, fallback = 'task'): string {
  const first = source.trim().split('\n')[0] || '';
  const withoutUrls = first.replace(/https?:\/\/\S+/gi, ' ');
  const slug = withoutUrls
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || fallback;
}

/**
 * The name a worktree takes when the task is against tracked work.
 *
 * `ref` is the short reference the link carries — `WEB-1234`, `acme/web#9404`
 * — and only its tail identifies the ticket: the repository is already implied
 * by the checkout the branch lives in, so `acme/web#9404` becomes `9404`, kept
 * readable as `issue-9404` rather than a bare number.
 */
export function ticketSlug(ref: string, kind?: string): string | undefined {
  const trimmed = (ref || '').trim();
  if (!trimmed) return undefined;
  const numbered = /#(\d+)$/.exec(trimmed);
  if (numbered) return `${kind === 'pr' ? 'pr' : 'issue'}-${numbered[1]}`;
  const key = /([A-Za-z][A-Za-z0-9_]*-\d+)\s*$/.exec(trimmed);
  if (key) return key[1]!.toLowerCase().replace(/_/g, '-');
  return worktreeSlug(trimmed, '') || undefined;
}

/** What to call a new worktree: the ticket when there is one, else the text. */
export function worktreeName(
  ticket: { ref?: string; kind?: string } | undefined,
  text: string,
  fallback = 'task'
): string {
  return (ticket?.ref ? ticketSlug(ticket.ref, ticket.kind) : undefined) || worktreeSlug(text, fallback);
}

export function worktreeBranch(slug: string): string {
  return `acp/${slug}`;
}

/** Where worktrees live: inside the repository, so anything scoped to it can reach them. */
export const WORKTREE_DIR = '.worktrees';

/**
 * The folder a new worktree is cut into.
 *
 * Under the repository root rather than beside it: an agent — and every tool
 * with a permission boundary drawn round the project — can read and write
 * inside the checkout it was pointed at, and nothing outside it. Git is happy
 * to nest a worktree there, and `.git/info/exclude` keeps it out of status
 * without touching the repository's own `.gitignore`.
 */
export function worktreePath(repoRoot: string, slug: string): string {
  return `${repoRoot.replace(/\/+$/, '')}/${WORKTREE_DIR}/${slug}`;
}

export interface WorktreeEntry {
  path: string;
  head?: string;
  /** Short branch name, absent when the checkout is detached or bare. */
  branch?: string;
  detached: boolean;
  bare: boolean;
  prunable: boolean;
}

/**
 * Entries from `git worktree list --porcelain`, main worktree first.
 *
 * Records are blank-line separated and every record opens with `worktree <path>`,
 * so a `worktree` line both starts a record and flushes the previous one — that
 * tolerates the trailing newline being trimmed away by the caller.
 */
export function parseWorktreeList(out: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let current: WorktreeEntry | null = null;

  for (const raw of out.split('\n')) {
    const line = raw.trimEnd();
    if (!line) continue;
    const sep = line.indexOf(' ');
    const key = sep === -1 ? line : line.slice(0, sep);
    const value = sep === -1 ? '' : line.slice(sep + 1).trim();

    if (key === 'worktree') {
      if (current) entries.push(current);
      current = { path: value, detached: false, bare: false, prunable: false };
      continue;
    }
    if (!current) continue;

    if (key === 'HEAD') current.head = value;
    else if (key === 'branch') current.branch = value.replace(/^refs\/heads\//, '');
    else if (key === 'detached') current.detached = true;
    else if (key === 'bare') current.bare = true;
    else if (key === 'prunable') current.prunable = true;
  }
  if (current) entries.push(current);

  return entries.filter(e => e.path);
}

/** Paths from `git status --porcelain`. Renames keep the destination. */
export function parseGitPorcelain(out: string): string[] {
  const files: string[] = [];
  for (const raw of out.split('\n')) {
    if (raw.length < 4) continue;
    let filePath = raw.slice(3).trim();
    if (filePath.startsWith('"') && filePath.endsWith('"')) {
      filePath = filePath.slice(1, -1).replace(/\\"/g, '"');
    }
    const arrow = filePath.lastIndexOf(' -> ');
    if (arrow >= 0) filePath = filePath.slice(arrow + 4);
    if (filePath) files.push(filePath);
  }
  return files;
}
