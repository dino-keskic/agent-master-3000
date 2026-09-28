import { BoardColumn, BoardTask, ProjectFolder } from '../types.js';
import { interpolateColumnPrompt } from './columns.js';
import { projectOwning } from './projectPaths.js';

/**
 * What one project adds to a column's prompt.
 *
 * A column's prompt is the same for every repo on the board; the standing
 * house rules ("run npm test", "read AGENTS.md") are not. Those live on the
 * *project*, in a `columnPrompts` map keyed by column id, and this module is
 * the only place that knows how the two halves are composed.
 *
 * Why on the project and not on the column:
 *
 * - Deleting a project splices one `ProjectFolder` out of the settings and its
 *   instructions go with it. Nothing else has to be swept, and no text naming a
 *   repo survives the repo being removed.
 * - Deleting a column leaves an unreferenced key behind, and that key is inert:
 *   every read here goes `column → project`, never the other way, so a map
 *   entry no column matches is never composed into anything. The column editor
 *   still prunes it on save (`pruneColumnPrompts`) so a later column that
 *   happens to slug to the same id cannot inherit an old project's rules.
 *
 * The reverse shape (`BoardColumn.projectPrompts`) makes exactly one of those
 * two deletes trivial instead of both, and puts per-repo text in the object the
 * board copies around and sanitizes on every settings write.
 *
 * Composition: the column's prompt first, the project's instructions last,
 * separated by a blank line. Last means last — a column template ends in
 * `{{prompt}}` as often as not, and inserting around a placeholder would make
 * the result depend on where the user happened to put it. Interpolation runs
 * over the composed text, so project instructions can use `{{title}}` too.
 *
 * A blank column prompt stays blank: the project's text is an *addition* to a
 * runnable column, not a prompt of its own. Otherwise a move-only column such
 * as Backlog would silently become runnable for one project.
 */

/** Between the column's prompt and the project's — a blank line, as in the templates. */
export const PROJECT_PROMPT_SEPARATOR = '\n\n';

export type ColumnPromptMap = Record<string, string>;

/** The instructions this project adds to this column, trimmed; '' when there are none. */
export function projectColumnPrompt(
  project: Pick<ProjectFolder, 'columnPrompts'> | undefined,
  columnId: string | undefined
): string {
  if (!project || !columnId) return '';
  return (project.columnPrompts?.[columnId] || '').trim();
}

/** Which projects have something to say about this column, in board order. */
export function projectsWithColumnPrompt<T extends Pick<ProjectFolder, 'columnPrompts'>>(
  projects: T[],
  columnId: string | undefined
): T[] {
  return projects.filter((project) => projectColumnPrompt(project, columnId).length > 0);
}

/**
 * The map with this column's entry set, or removed when the text is blank —
 * clearing the box is how the user deletes the instructions, so a whitespace
 * value must never be stored as if it were one.
 */
export function setColumnPrompt(
  map: ColumnPromptMap | undefined,
  columnId: string,
  text: string
): ColumnPromptMap {
  const next: ColumnPromptMap = { ...(map || {}) };
  if (text.trim()) next[columnId] = text;
  else delete next[columnId];
  return next;
}

/** Drop entries for columns the board no longer has. */
export function pruneColumnPrompts(
  map: ColumnPromptMap | undefined,
  columnIds: Iterable<string>
): ColumnPromptMap {
  const live = new Set(columnIds);
  const next: ColumnPromptMap = {};
  for (const [columnId, text] of Object.entries(map || {})) {
    if (live.has(columnId) && text.trim()) next[columnId] = text;
  }
  return next;
}

/** True when the two maps would compose the same instructions everywhere. */
export function sameColumnPrompts(a: ColumnPromptMap | undefined, b: ColumnPromptMap | undefined): boolean {
  const left = pruneColumnPromptsAll(a);
  const right = pruneColumnPromptsAll(b);
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => left[key] === right[key]);
}

function pruneColumnPromptsAll(map: ColumnPromptMap | undefined): ColumnPromptMap {
  const next: ColumnPromptMap = {};
  for (const [columnId, text] of Object.entries(map || {})) {
    if (text.trim()) next[columnId] = text;
  }
  return next;
}

/**
 * A map off the wire. Anything that is not a string keyed by a column id is
 * dropped rather than rejected — the board must load a hand-edited state file.
 */
export function sanitizeColumnPrompts(input: unknown): ColumnPromptMap | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const out: ColumnPromptMap = {};
  for (const [columnId, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value !== 'string') continue;
    if (!columnId.trim() || !value.trim()) continue;
    out[columnId] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * The template that actually runs for this column in this project: the
 * column's prompt, then the project's instructions. Still a template —
 * placeholders are interpolated by the caller.
 */
export function effectiveColumnPrompt(
  column: Pick<BoardColumn, 'id' | 'prompt'> | undefined,
  project: Pick<ProjectFolder, 'columnPrompts'> | undefined
): string {
  const base = (column?.prompt || '').trim();
  if (!base) return '';
  const extra = projectColumnPrompt(project, column?.id);
  return extra ? `${base}${PROJECT_PROMPT_SEPARATOR}${extra}` : base;
}

type PromptTask = Pick<BoardTask, 'title' | 'prompt'> & {
  originalPrompt?: string;
  description?: string;
  projectId?: string;
  cwd?: string;
};

/**
 * What to send when this task runs in this column — `resolveRunPrompt` with the
 * task's own project folded in. An explicit follow-up still wins, and a task in
 * no known project gets the column's prompt unchanged.
 */
export function resolveProjectRunPrompt(
  column: BoardColumn | undefined,
  task: PromptTask,
  projects: ProjectFolder[],
  explicitPrompt?: string
): string | undefined {
  const explicit = explicitPrompt?.trim();
  if (explicit) return explicit;
  const project = projectOwning(projects, task.projectId, task.cwd);
  const template = effectiveColumnPrompt(column, project);
  if (!template) return undefined;
  return interpolateColumnPrompt(template, task);
}
