/**
 * What the command palette (⌘K / ⌘P) lists for a query.
 *
 * The palette is one box that finds a task by anything people call it — its
 * title, its board id, the ticket or PR it is against, the project it runs in,
 * a session's name — and runs the board's own commands, and turns whatever was
 * typed into a new task. Deciding what matches and in what order is all here,
 * so it can be tested without a screen; the component only draws the answer.
 */

import { BoardColumn, BoardTask, TaskRunState } from '../types.js';
import { sortTaskLinks } from '../task/links.js';

/** Something the palette can run that is not a task: open a panel, flip the theme. */
export interface PaletteCommand {
  id: string;
  title: string;
  /** Extra words it should be found by — "cost" for Spend, "dark" for the theme. */
  keywords?: string;
  /** The shortcut or state shown at the row's right edge. */
  hint?: string;
}

/** A task as a palette row: what is printed, and what it is found by. */
export interface PaletteTask {
  taskId: string;
  title: string;
  runState: TaskRunState;
  columnTitle?: string;
  /** Project or worktree it runs in. */
  place?: string;
  /** Ticket keys and PR refs, tracked work first. */
  refs: string[];
  updatedAt: number;
}

export type PaletteResult =
  | { kind: 'task'; id: string; task: PaletteTask }
  | { kind: 'command'; id: string; command: PaletteCommand }
  | { kind: 'create'; id: string; text: string };

export interface PaletteSection {
  label: string;
  results: PaletteResult[];
}

/** Rows of tasks shown before the list is cut; a palette is not a table. */
export const PALETTE_TASK_LIMIT = 8;
/** Tasks offered before anything is typed. */
export const PALETTE_RECENT_LIMIT = 6;

/** How much a hit in each kind of text counts. A title names the task; a prompt merely mentions things. */
const WEIGHT = { name: 3, ref: 3, context: 1.5, body: 1 } as const;

interface Haystack {
  text: string;
  weight: number;
}

function words(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * How well one word sits in one text: the whole text, the start of a word in
 * it, or merely somewhere inside. `web` should find `WEB-1234` before it finds
 * `cobweb`.
 */
export function wordScore(word: string, text: string): number {
  if (!word || !text) return 0;
  const hay = text.toLowerCase();
  if (hay === word) return 1.5;
  let from = 0;
  let best = 0;
  while (from <= hay.length) {
    const at = hay.indexOf(word, from);
    if (at === -1) break;
    if (at === 0 || !/[a-z0-9]/.test(hay[at - 1]!)) return 1;
    best = 0.6;
    from = at + 1;
  }
  return best;
}

/** Every word must land somewhere, or the row is not a match at all. */
function score(queryWords: string[], haystacks: Haystack[]): number {
  let total = 0;
  for (const word of queryWords) {
    let best = 0;
    for (const hay of haystacks) {
      const hit = wordScore(word, hay.text) * hay.weight;
      if (hit > best) best = hit;
    }
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

function paletteTask(task: BoardTask, columns: BoardColumn[]): PaletteTask {
  const refs = sortTaskLinks(task.links)
    .map((link) => link.ref)
    .filter((ref): ref is string => !!ref);
  return {
    taskId: task.id,
    title: task.title || task.id,
    runState: task.runState,
    columnTitle: columns.find((column) => column.id === task.columnId)?.title,
    place: task.worktreeLabel || task.projectName || undefined,
    refs: [...new Set(refs)],
    updatedAt: task.updatedAt
  };
}

function taskHaystacks(task: BoardTask, entry: PaletteTask): Haystack[] {
  const links = task.links || [];
  return [
    { text: entry.title, weight: WEIGHT.name },
    { text: task.id, weight: WEIGHT.ref },
    ...entry.refs.map((text) => ({ text, weight: WEIGHT.ref })),
    ...links.map((link) => ({ text: link.title, weight: WEIGHT.context })),
    { text: entry.place || '', weight: WEIGHT.context },
    { text: task.projectName || '', weight: WEIGHT.context },
    { text: entry.columnTitle || '', weight: WEIGHT.context },
    ...(task.sessions || []).map((session) => ({ text: session.title, weight: WEIGHT.context })),
    { text: task.description || '', weight: WEIGHT.body },
    { text: task.originalPrompt || task.prompt || '', weight: WEIGHT.body }
  ].filter((hay) => hay.text);
}

/** Blocked on you, then working, then everything else — the order attention goes in. */
function attention(state: TaskRunState): number {
  if (state === 'awaiting_input') return 2;
  if (state === 'running' || state === 'error') return 1;
  return 0;
}

/**
 * The palette's contents for what has been typed.
 *
 * Nothing typed: the tasks most likely wanted (waiting on you, then the most
 * recently touched) and every command. Something typed: the tasks and commands
 * it matches, best first, and always the offer to make it a new task — last,
 * so Enter on a search opens what was found rather than creating a duplicate,
 * unless nothing was found.
 */
export function searchPalette(
  query: string,
  tasks: BoardTask[],
  columns: BoardColumn[],
  commands: PaletteCommand[]
): PaletteSection[] {
  const live = tasks.filter((task) => !task.archivedAt);
  const text = query.trim();
  const queryWords = words(text);
  const sections: PaletteSection[] = [];

  if (queryWords.length === 0) {
    const recent = live
      .map((task) => paletteTask(task, columns))
      .sort((a, b) => attention(b.runState) - attention(a.runState) || b.updatedAt - a.updatedAt)
      .slice(0, PALETTE_RECENT_LIMIT);
    if (recent.length) {
      sections.push({
        label: 'Recent tasks',
        results: recent.map((task) => ({ kind: 'task', id: `task:${task.taskId}`, task }))
      });
    }
    if (commands.length) {
      sections.push({
        label: 'Commands',
        results: commands.map((command) => ({ kind: 'command', id: `command:${command.id}`, command }))
      });
    }
    return sections;
  }

  const matchedTasks = live
    .map((task) => {
      const entry = paletteTask(task, columns);
      return { entry, score: score(queryWords, taskHaystacks(task, entry)) };
    })
    .filter((hit) => hit.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        attention(b.entry.runState) - attention(a.entry.runState) ||
        b.entry.updatedAt - a.entry.updatedAt
    )
    .slice(0, PALETTE_TASK_LIMIT);
  if (matchedTasks.length) {
    sections.push({
      label: 'Tasks',
      results: matchedTasks.map(({ entry }) => ({ kind: 'task', id: `task:${entry.taskId}`, task: entry }))
    });
  }

  const matchedCommands = commands
    .map((command) => ({
      command,
      score: score(queryWords, [
        { text: command.title, weight: WEIGHT.name },
        { text: command.keywords || '', weight: WEIGHT.context }
      ])
    }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score);
  if (matchedCommands.length) {
    sections.push({
      label: 'Commands',
      results: matchedCommands.map(({ command }) => ({ kind: 'command', id: `command:${command.id}`, command }))
    });
  }

  sections.push({ label: 'New', results: [{ kind: 'create', id: 'create', text }] });
  return sections;
}

/** The rows in the order the arrow keys walk them. */
export function flattenSections(sections: PaletteSection[]): PaletteResult[] {
  return sections.flatMap((section) => section.results);
}

/** The next highlighted row; the list wraps at both ends. */
export function moveSelection(index: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (((index + delta) % count) + count) % count;
}

/** True for the chord that opens the palette: ⌘K or ⌘P (Ctrl off a Mac), nothing else held. */
export function isPaletteChord(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean {
  if (event.altKey || event.shiftKey) return false;
  if (event.metaKey === event.ctrlKey) return false;
  const key = event.key.toLowerCase();
  return key === 'k' || key === 'p';
}
