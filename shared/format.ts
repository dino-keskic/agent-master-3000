/** Presentation helpers shared by the board, the drawer and the session lists. */

import { BoardColumn, BoardTask, ThinkingLevelOption } from './types.js';

/** Coarse "x ago" for card timestamps. Accepts epoch ms or an ISO string. */
export function relativeTime(when: number | string): string {
  const then = typeof when === 'number' ? when : Date.parse(when);
  if (!Number.isFinite(then)) return '';

  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;

  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(then).toLocaleDateString();
}

/**
 * Compact running duration: `14s`, `1m 04s`, `2h 03m`. `now` is injected so
 * this stays a pure function — shared/ does not read the clock itself.
 */
export function elapsed(startedAt: number, now: number): string {
  const secs = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  if (mins < 60) return `${mins}m ${String(rem).padStart(2, '0')}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${String(mins % 60).padStart(2, '0')}m`;
}

/** `provider/model-id` -> `model-id`, plus the Copilot prefix the UI strips. */
export function shortModelLabel(id: string, name?: string): string {
  const raw = name || id;
  if (raw.includes('/')) return raw.split('/').pop() || raw;
  return raw.replace(/^GitHub Copilot\//i, '');
}

/** `/a/b/c/d` -> `…/c/d`, for paths shown in tight rows. */
export function shortPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts.length <= 2 ? path : `…/${parts.slice(-2).join('/')}`;
}

/**
 * What the run button should say: a column with a prompt runs that column,
 * otherwise it continues an existing session or starts a new one.
 */
export function runButtonLabel(column: BoardColumn | undefined, task: Pick<BoardTask, 'sessionId'>): string {
  if (column?.prompt.trim()) return `Run ${column.title}`;
  return task.sessionId ? 'Continue' : 'Run';
}

/**
 * Single source of truth for the thinking-level dropdowns.
 *
 * Only what OpenCode reports for the model in question. There is deliberately
 * no static list behind this: effort levels are per model — different names,
 * different counts, and plenty of models have none — so a hardcoded fallback
 * offers levels the model will reject. An empty list means we have not been
 * told yet, and "Default" is then the honest whole menu.
 */
export function thinkingLevelOptions(
  effortLevels: ThinkingLevelOption[],
  { lowercase = false }: { lowercase?: boolean } = {}
): { value: string; label: string }[] {
  const cased = (text: string) => (lowercase ? text.toLowerCase() : text);
  return [
    { value: 'default', label: cased('Default') },
    ...effortLevels.map((e) => ({ value: e.value, label: cased(e.name || e.value) }))
  ];
}

const MAX_TITLE_LENGTH = 70;

/**
 * A card title derived from the first line of a prompt.
 *
 * Deliberately produces no ellipsis: the title is interpolated into
 * `{{title}}` and fed to the agent, and a trailing "..." reads as a truncated
 * instruction — models have responded by asking what was cut off. Cards clamp
 * long titles with CSS instead, which is a display concern.
 *
 * Markdown links collapse to their text first. A prompt that @-mentions a
 * ticket carries `[KEY — summary](url)`, and clipping that raw leaves a card
 * titled with half a URL and an unclosed bracket.
 */
export function deriveTaskTitle(text: string, fallback = 'Untitled task'): string {
  const flat = text.replace(/\[([^\]]+)\]\((?:[^()\s]|\([^()]*\))*\)/g, '$1');
  const firstLine = (flat.trim().split('\n')[0] || '').trim();
  if (!firstLine) return fallback;
  if (firstLine.length <= MAX_TITLE_LENGTH) return firstLine;

  // Prefer cutting at a word boundary so the title stays readable.
  const clipped = firstLine.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = clipped.lastIndexOf(' ');
  const cut = lastSpace > MAX_TITLE_LENGTH * 0.6 ? clipped.slice(0, lastSpace) : clipped;
  return cut.replace(/[\s.,;:—–-]+$/, '') || fallback;
}

/** OpenCode placeholders that should never replace a real task title. */
export function isPlaceholderSessionTitle(title: string | undefined): boolean {
  const text = (title || '').replace(/\s+/g, ' ').trim();
  if (!text) return true;
  if (/^New session\b/i.test(text)) return true;
  if (/^Untitled\b/i.test(text)) return true;
  if (/subagent/i.test(text)) return true;
  if (/^(Side Chat|Fork:)/i.test(text) && text.length < 12) return true;
  return false;
}

const MAX_SUBAGENT_LABEL = 42;

/**
 * Sidebar label for an OpenCode child session. Prefer `@name` in titles like
 * `Review PR (@coderabbit-code-reviewer subagent)`; otherwise drop a trailing
 * " subagent" and clip so a prompt never becomes the row text.
 */
export function subagentDisplayName(title: string | undefined): string {
  const text = (title || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'Subagent';
  const named = /@([^\s)]+)/.exec(text);
  if (named?.[1]) return `@${named[1]}`;
  const stripped = text.replace(/\s*subagent$/i, '').trim();
  const label = stripped || 'Subagent';
  if (label.length <= MAX_SUBAGENT_LABEL) return label;
  return `${label.slice(0, MAX_SUBAGENT_LABEL).trimEnd()}…`;
}

/**
 * True when the card title is still the prompt we derived, so an OpenCode
 * session rename is allowed to replace it. A title the user typed is left
 * alone (`titleLocked`).
 */
export function isAutoTaskTitle(task: {
  title: string;
  prompt?: string;
  originalPrompt?: string;
  titleLocked?: boolean;
}): boolean {
  if (task.titleLocked) return false;
  const current = task.title.trim();
  if (!current) return true;
  if (/^(Untitled task|Imported session|Side Chat|New session)$/i.test(current)) return true;
  for (const source of [task.originalPrompt, task.prompt]) {
    if (!source?.trim()) continue;
    if (current === deriveTaskTitle(source)) return true;
    if (current === source.trim().split('\n')[0]!.trim()) return true;
  }
  return false;
}

/**
 * Strips the truncation marker off titles saved by older builds, so a stored
 * "Do the thing..." never reaches the agent looking like a cut-off sentence.
 */
export function cleanTitleForPrompt(title: string): string {
  return title.replace(/\s*(\.{3}|…)\s*$/, '').trim();
}
