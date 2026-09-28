/**
 * Which project a folder belongs to.
 *
 * The board answered this in two places that had drifted apart: the live
 * overlay that labels a card counted a sibling `.worktrees/` checkout as part
 * of the project, the query that tags a starting session did not — so the same
 * folder could read as project A on the card and as no project at all in the
 * log. Moving work between projects needs one answer, because the move writes
 * the folder and everything else reads the label back off it.
 */

/** A path without its trailing slashes, so two spellings of a folder compare equal. */
export function normalizeFolder(path: string | undefined): string {
  return (path || '').replace(/\/+$/, '');
}

/**
 * True when the folder is the project's root, sits inside it, or is one of its
 * sibling worktrees — `<root>.worktrees/feature-x`, which is where a checkout
 * made for the project lands.
 */
export function folderInProject(cwd: string | undefined, projectPath: string | undefined): boolean {
  const folder = normalizeFolder(cwd);
  const root = normalizeFolder(projectPath);
  if (!folder || !root) return false;
  return folder === root
    || folder.startsWith(`${root}/`)
    || folder.startsWith(`${root}.worktrees/`);
}

/**
 * True when the folder is one of the checkouts git reports for a repo, or sits
 * inside one.
 *
 * `git worktree list` is the only authority on this. A worktree lands wherever
 * it was made: the board's own go next to the project, but OpenCode keeps its
 * under `~/.local/share/opencode/worktree/`, and one cut for a pull request can
 * sit in a temp folder. None of those are inside the project, so path shape
 * cannot answer the question and containment alone turns away real checkouts.
 */
export function folderInCheckouts(cwd: string | undefined, checkouts: (string | undefined)[]): boolean {
  const folder = normalizeFolder(cwd);
  if (!folder) return false;
  return checkouts.some((checkout) => {
    const root = normalizeFolder(checkout);
    if (!root) return false;
    return folder === root || folder.startsWith(`${root}/`);
  });
}

/**
 * The project a folder belongs to. The deepest root wins, so a project added
 * inside another one keeps its own folders.
 */
export function projectForFolder<T extends { path: string }>(
  cwd: string | undefined,
  projects: T[]
): T | undefined {
  let best: T | undefined;
  for (const project of projects) {
    if (!folderInProject(cwd, project.path)) continue;
    if (!best || normalizeFolder(project.path).length > normalizeFolder(best.path).length) best = project;
  }
  return best;
}

/**
 * The project something belongs to: the folder it runs in, else the id it was
 * tagged with. Folder first because that is where the next turn actually goes;
 * the id is only left to answer for a project whose path has moved on.
 */
export function projectOwning<T extends { id?: string; path: string }>(
  projects: T[],
  projectId?: string,
  cwd?: string
): T | undefined {
  return projectForFolder(cwd, projects)
    || (projectId ? projects.find((project) => project.id === projectId) : undefined);
}
