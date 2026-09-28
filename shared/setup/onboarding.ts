import { BoardState, BoardTask, ProjectFolder } from '../types.js';
import { normalizeFolder, projectForFolder } from '../board/projectPaths.js';

/**
 * The first run: a board with nothing on it, and the folders to offer it.
 *
 * A new board starts with no project. Older versions seeded one pointing at
 * whatever folder the server happened to start in — the checkout in
 * development, the user's home folder once installed — and called it
 * "agent-master-3000" either way, so every new user opened a board aimed at somewhere
 * they never chose. What decides whether to greet them instead, what becomes
 * of that seeded project, and which folders are worth suggesting all live here.
 */

/** The id the seeded project was always written with. */
export const SEEDED_PROJECT_ID = 'proj-agent-master-3000';

/**
 * Removes the seeded project from a board that never used it — no task at all,
 * archived ones included, since the only way that happens is that nobody has
 * worked on this board yet. A board with tasks keeps it: there it may well be
 * the user's own project by now. Returns whether anything changed.
 */
export function dropUnusedSeededProject(state: BoardState): boolean {
  if (state.tasks.length > 0) return false;
  const { settings } = state;
  if (!settings.projects.some((project) => project.id === SEEDED_PROJECT_ID)) return false;
  settings.projects = settings.projects.filter((project) => project.id !== SEEDED_PROJECT_ID);
  if (settings.selectedProjectId === SEEDED_PROJECT_ID) {
    settings.selectedProjectId = settings.projects[0]?.id;
    if (settings.projects[0]) settings.defaultCwd = settings.projects[0].path;
  }
  return true;
}

/**
 * Whether the board should greet the user rather than show itself. Only a
 * board that is empty in both senses: tasks without a project (imported from
 * anywhere) are still work to look at, and hiding them behind a welcome would
 * lose them.
 */
export function needsOnboarding(projects: ProjectFolder[], tasks: Pick<BoardTask, 'id'>[]): boolean {
  return projects.length === 0 && tasks.length === 0;
}

/** One folder OpenCode has root sessions in, as its database groups them. */
export interface FolderActivity {
  directory: string;
  /** OpenCode's own project root for these sessions, when it knows one. */
  worktree?: string;
  sessions: number;
  /** Epoch milliseconds of the newest session there. */
  lastActive: number;
}

export interface ProjectSuggestion {
  path: string;
  name: string;
  sessions: number;
  lastActive: number;
}

/**
 * The project a session folder belongs to. OpenCode's answer first; failing
 * that, a board-made `<root>.worktrees/<name>` checkout counts as its root.
 * OpenCode's global project has the filesystem root as its worktree, which is
 * no answer at all, so the folder stands for itself there.
 */
function projectRoot(row: FolderActivity): string {
  const worktree = normalizeFolder(row.worktree);
  if (worktree && worktree !== '/') return worktree;
  const folder = normalizeFolder(row.directory);
  return /^(.*)\.worktrees\/[^/]+$/.exec(folder)?.[1] || folder;
}

function folderName(folder: string): string {
  return folder.slice(folder.lastIndexOf('/') + 1) || folder;
}

/**
 * The folders to offer a new board, busiest-recently first.
 *
 * Sessions are rolled up to their project, so twenty worktrees of one repo are
 * one suggestion. Left out: the filesystem root and the home folder, which are
 * where people run an agent for a quick question rather than a project; a
 * folder the board already has, or sits inside; and a folder `exists` says is
 * gone.
 */
export function suggestProjects(
  rows: FolderActivity[],
  options: {
    projects: Pick<ProjectFolder, 'path'>[];
    home?: string;
    exists?: (folder: string) => boolean;
    limit?: number;
  }
): ProjectSuggestion[] {
  const home = normalizeFolder(options.home);
  const byRoot = new Map<string, ProjectSuggestion>();
  for (const row of rows) {
    const root = projectRoot(row);
    if (!root || root === home || !root.startsWith('/')) continue;
    const entry = byRoot.get(root) || { path: root, name: folderName(root), sessions: 0, lastActive: 0 };
    entry.sessions += row.sessions;
    entry.lastActive = Math.max(entry.lastActive, row.lastActive);
    byRoot.set(root, entry);
  }

  const suggestions = [...byRoot.values()]
    .filter((entry) => !projectForFolder(entry.path, options.projects))
    .sort((a, b) => b.lastActive - a.lastActive || b.sessions - a.sessions);

  const limit = options.limit ?? suggestions.length;
  const kept: ProjectSuggestion[] = [];
  // Existence is the one check that touches the disk, so it runs only until
  // the list is full rather than over every folder OpenCode ever saw.
  for (const entry of suggestions) {
    if (kept.length >= limit) break;
    if (!options.exists || options.exists(entry.path)) kept.push(entry);
  }
  return kept;
}
