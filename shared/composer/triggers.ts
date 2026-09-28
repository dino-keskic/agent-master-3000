/**
 * The two composer triggers, split the way every agent chat splits them:
 * `/` runs something, `@` refers to something.
 *
 * They were one menu behind `/` before, which meant a ticket key and a command
 * name competed for the same token and neither read as what it was.
 */

export interface Trigger {
  /** Index of the `/` or `@` that opened the menu. */
  start: number;
  query: string;
}

/** Characters that, immediately before the trigger, mean it is part of a word. */
const GLUED = /[\w/.@#-]/;

function triggerAt(text: string, cursor: number, char: '/' | '@'): Trigger | null {
  const pos = Math.max(0, Math.min(cursor, text.length));
  const before = text.slice(0, pos);
  const at = before.lastIndexOf(char);
  if (at < 0) return null;
  // A trigger has to start a token: `src/foo` is a path and `a@b` is an email.
  if (at > 0 && GLUED.test(before[at - 1] || '')) return null;
  const query = before.slice(at + 1);
  if (/[\s\n]/.test(query)) return null;
  return { start: at, query };
}

/** `/name` — commands and skills. */
export function slashTrigger(text: string, cursor: number): Trigger | null {
  return triggerAt(text, cursor, '/');
}

/**
 * `@thing` — files, Jira tickets and GitHub PRs. The query keeps `/`, `.` and
 * `#` so `@src/components/App.tsx` and `@web-app#9404` stay one token.
 */
export function atTrigger(text: string, cursor: number): Trigger | null {
  return triggerAt(text, cursor, '@');
}

/**
 * Both triggers, resolved to whichever one the caret is actually inside. The
 * later of the two wins: in `@src/foo` the `/` is glued to a word and never
 * opens, but the caret can move between two separate tokens on one line.
 */
export function composerTrigger(
  text: string,
  cursor: number
): { kind: 'slash' | 'at'; trigger: Trigger } | null {
  const slash = slashTrigger(text, cursor);
  const at = atTrigger(text, cursor);
  if (slash && at) return slash.start > at.start ? { kind: 'slash', trigger: slash } : { kind: 'at', trigger: at };
  if (slash) return { kind: 'slash', trigger: slash };
  if (at) return { kind: 'at', trigger: at };
  return null;
}

/** Swap the `/query` or `@query` token for whatever the picked row inserts. */
export function replaceTrigger(
  text: string,
  trigger: Trigger,
  cursor: number,
  insertion: string
): { text: string; cursor: number } {
  return {
    text: `${text.slice(0, trigger.start)}${insertion}${text.slice(cursor)}`,
    cursor: trigger.start + insertion.length
  };
}
