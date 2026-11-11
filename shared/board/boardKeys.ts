/**
 * What a bare key means on the board.
 *
 * j and k walk the tasks, Enter opens the one the walk is on, n starts a new
 * one. All of it is off while something is being typed, while a panel is open
 * over the board, and whenever a modifier is held — those belong to the
 * browser, the palette and the composer.
 */

export type BoardKeyAction = 'next' | 'previous' | 'open' | 'new';

export interface BoardKey {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export interface BoardKeyContext {
  /** The key landed in a text field, a select, or anything editable. */
  typing: boolean;
  /** A modal, sheet or palette is up and owns the keyboard. */
  blocked: boolean;
  /** A task is open: the walk moves the open task, so Enter has nothing to add. */
  taskOpen: boolean;
}

export function boardKeyAction(event: BoardKey, context: BoardKeyContext): BoardKeyAction | undefined {
  if (context.blocked) return undefined;
  const key = event.key.toLowerCase();

  // ⌘N / Ctrl+N works from inside a field too. A browser keeps the chord for
  // its own new window and never delivers it; the desktop app does.
  if (key === 'n' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) return 'new';

  if (context.typing || event.metaKey || event.ctrlKey || event.altKey) return undefined;
  if (key === 'j' || key === 'arrowdown') return 'next';
  if (key === 'k' || key === 'arrowup') return 'previous';
  if (key === 'n') return 'new';
  if (key === 'enter' && !context.taskOpen) return 'open';
  return undefined;
}

/** Tag names and roles a keystroke is meant for, rather than for the board. */
export function isTypingTarget(target: { tagName?: string; isContentEditable?: boolean; role?: string | null }): boolean {
  if (target.isContentEditable) return true;
  const tag = target.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return target.role === 'textbox' || target.role === 'combobox' || target.role === 'listbox' || target.role === 'menuitem';
}
