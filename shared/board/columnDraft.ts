import { BoardColumn } from '../types.js';
import { columnRunsOnDrop, uniqueColumnId } from './columns.js';

/**
 * Editing the list of columns.
 *
 * The board's own column logic lives in `columns.ts`; this is the
 * narrower job of the editor — reordering, adding, removing, and deciding
 * what a half-finished draft means once it is saved.
 */

/** The one-line "what does this column do" note under its name in the list. */
export function columnSummaryLine(column: BoardColumn, taskCount: number): string {
  return [
    `${taskCount} task${taskCount === 1 ? '' : 's'}`,
    ...(columnRunsOnDrop(column) ? ['drop runs'] : []),
    ...(column.compactOnEnter ? ['compacts'] : []),
    ...(column.newSessionOnEnter ? ['fresh session'] : [])
  ].join(' · ');
}

/** Reorder by one place. Moving off either end is a no-op, not a wrap. */
export function moveColumn(columns: BoardColumn[], index: number, dir: -1 | 1): BoardColumn[] {
  const next = index + dir;
  if (index < 0 || index >= columns.length || next < 0 || next >= columns.length) return columns;
  const copy = [...columns];
  const [item] = copy.splice(index, 1);
  if (item) copy.splice(next, 0, item);
  return copy;
}

/**
 * Drop a column, and say which one to select instead: the neighbour above,
 * so the selection stays where the user was looking. A board needs at least
 * one column, so the last one will not go.
 */
export function removeColumn(
  columns: BoardColumn[],
  index: number
): { columns: BoardColumn[]; selectId: string | undefined } {
  if (columns.length <= 1 || index < 0 || index >= columns.length) {
    return { columns, selectId: columns[index]?.id };
  }
  const next = columns.filter((_, i) => i !== index);
  return { columns: next, selectId: next[Math.max(0, index - 1)]?.id };
}

/** Add an empty column at the end, with an id no sibling is already using. */
export function appendColumn(
  columns: BoardColumn[],
  title = 'New column'
): { columns: BoardColumn[]; id: string } {
  const id = uniqueColumnId(title, columns.map((column) => column.id));
  return { columns: [...columns, { id, title, prompt: '', autoRun: false }], id };
}

/**
 * What actually gets saved: titles trimmed, blank optionals dropped so they
 * fall back to the task's own settings, and auto-run held to its prompt.
 */
export function cleanColumnDraft(columns: BoardColumn[]): BoardColumn[] {
  return columns.map((column) => ({
    ...column,
    title: column.title.trim() || 'Untitled',
    autoRun: columnRunsOnDrop(column),
    compactOnEnter: column.compactOnEnter || undefined,
    newSessionOnEnter: column.newSessionOnEnter || undefined,
    model: column.model || undefined,
    agent: column.agent || undefined,
    thinkingLevel: column.thinkingLevel || undefined
  }));
}

/** A column with no name cannot be told apart on the board, so it blocks Save. */
export function canSaveColumnDraft(columns: BoardColumn[]): boolean {
  return columns.length > 0 && columns.every((column) => column.title.trim().length > 0);
}
