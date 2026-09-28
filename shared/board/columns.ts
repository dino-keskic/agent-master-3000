import { BoardColumn, BoardTask, PermissionMode } from '../types.js';
import { cleanTitleForPrompt } from '../format.js';

export const DEFAULT_COLUMNS: BoardColumn[] = [
  {
    id: 'backlog',
    title: 'Backlog',
    prompt: '',
    autoRun: false
  },
  {
    id: 'plan',
    title: 'Plan',
    prompt: [
      'Read the repository and produce a concise implementation plan for this task.',
      'Do not write or edit code yet. List the files you would change, the approach, and any risks.',
      '',
      '{{prompt}}'
    ].join('\n'),
    autoRun: true
  },
  {
    id: 'execute',
    title: 'Execute',
    prompt: [
      'Implement the plan already in this conversation. Make the code changes, then summarize what you did.',
      'Do not re-plan. Do not repeat earlier column instructions.'
    ].join('\n'),
    autoRun: true
  },
  {
    id: 'deliver',
    title: 'Deliver',
    prompt: [
      'Review the work done in this conversation.',
      'Check for leftover todos, failing tests, and incomplete pieces.',
      'Summarize what is ready to ship and what is not. Do not start new feature work.'
    ].join('\n'),
    autoRun: false
  }
];

/** Old board statuses → default column ids. */
export const LEGACY_STATUS_TO_COLUMN: Record<string, string> = {
  todo: 'backlog',
  in_progress: 'execute',
  in_review: 'deliver',
  done: 'deliver'
};

export function cloneDefaultColumns(): BoardColumn[] {
  return DEFAULT_COLUMNS.map((column) => ({ ...column }));
}

export function normalizeColumnId(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'column';
}

export function uniqueColumnId(title: string, existing: Iterable<string>): string {
  const used = new Set(existing);
  const base = normalizeColumnId(title);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function permissionModeOrUndef(value: unknown): PermissionMode | undefined {
  return value === 'auto' || value === 'review-writes' || value === 'manual' ? value : undefined;
}

function emptyToUndef(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function sanitizeColumns(input: unknown): BoardColumn[] {
  if (!Array.isArray(input) || input.length === 0) {
    return cloneDefaultColumns();
  }

  const seen = new Set<string>();
  const out: BoardColumn[] = [];

  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const rec = raw as Record<string, unknown>;
    const title = (typeof rec.title === 'string' ? rec.title : '').trim() || 'Untitled';
    let id = normalizeColumnId(typeof rec.id === 'string' && rec.id ? rec.id : title);
    if (seen.has(id)) id = uniqueColumnId(id, seen);
    seen.add(id);
    out.push(migrateLegacyColumnPrompt({
      id,
      title,
      prompt: typeof rec.prompt === 'string' ? rec.prompt : '',
      autoRun: Boolean(rec.autoRun),
      compactOnEnter: rec.compactOnEnter ? true : undefined,
      newSessionOnEnter: rec.newSessionOnEnter ? true : undefined,
      model: emptyToUndef(rec.model),
      agent: emptyToUndef(rec.agent),
      thinkingLevel: emptyToUndef(rec.thinkingLevel),
      permissionMode: permissionModeOrUndef(rec.permissionMode)
    }));
  }

  return out.length > 0 ? out : cloneDefaultColumns();
}

/** A prompt is what makes a column runnable, so an empty one cannot auto-run. */
export function columnRunsOnDrop(column: BoardColumn): boolean {
  return Boolean(column.autoRun && column.prompt.trim());
}

export function findColumn(columns: BoardColumn[], columnId: string | undefined): BoardColumn | undefined {
  if (!columnId) return undefined;
  return columns.find((column) => column.id === columnId);
}

/**
 * What a drop onto this column is allowed to start.
 *
 * A running turn is not interrupted by a drag — auto-run, compact, and a
 * fresh session only fire for idle cards. Those flags still have to be on
 * for the idle case; they are the explicit enable, not a reason to barge in.
 */
export function columnEnterActions(
  column: BoardColumn,
  options: { sameColumn: boolean; alreadyRan: boolean; busy: boolean; hasSession: boolean }
): { autoRun: boolean; compact: boolean; newSession: boolean } {
  if (options.sameColumn || options.busy) {
    return { autoRun: false, compact: false, newSession: false };
  }
  const newSession = !!column.newSessionOnEnter && options.hasSession;
  const autoRun = !options.alreadyRan && column.autoRun && !!column.prompt.trim();
  const compact = !!column.compactOnEnter && !newSession && options.hasSession;
  return { autoRun, compact, newSession };
}

export function fallbackColumnId(columns: BoardColumn[]): string {
  return columns[0]?.id || 'backlog';
}

export function resolveColumnId(columns: BoardColumn[], columnId: string | undefined, legacyStatus?: string): string {
  const ids = new Set(columns.map((column) => column.id));
  if (columnId && ids.has(columnId)) return columnId;
  const mapped = legacyStatus ? LEGACY_STATUS_TO_COLUMN[legacyStatus] : undefined;
  if (mapped && ids.has(mapped)) return mapped;
  return fallbackColumnId(columns);
}

const COLUMN_LEAD_INS = [
  'Read the repository and produce a concise implementation plan for this task.',
  'Implement this task. Follow any plan already in this conversation.',
  'Implement the plan already in this conversation.',
  'Review the work done in this conversation.'
];

export function looksLikeColumnPrompt(text: string): boolean {
  const trimmed = text.trim();
  return COLUMN_LEAD_INS.some((lead) => trimmed.startsWith(lead) || trimmed.includes(lead));
}

/** Recover the user's original request from a stacked Plan/Execute interpolation. */
export function unwrapStackedColumnPrompt(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (!looksLikeColumnPrompt(trimmed)) return trimmed;

  const blocks = trimmed.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (!block || looksLikeColumnPrompt(block)) continue;
    if (/^Task:\s*/i.test(block)) {
      const rest = block.replace(/^Task:\s*/i, '').trim();
      if (rest && !looksLikeColumnPrompt(rest)) return rest;
      continue;
    }
    return block;
  }
  const lines = trimmed.split('\n').map((line) => line.trim()).filter(Boolean);
  const last = [...lines].reverse().find((line) => line && !looksLikeColumnPrompt(line) && !/^Task:/i.test(line));
  return last || trimmed;
}

export function userTaskPrompt(
  task: Pick<BoardTask, 'prompt'> & { originalPrompt?: string; description?: string; title?: string }
): string {
  const original = task.originalPrompt?.trim();
  if (original && !looksLikeColumnPrompt(original)) return original;
  const unwrapped = unwrapStackedColumnPrompt(task.prompt || task.description || '');
  if (unwrapped) return unwrapped;
  return (task.title || '').trim();
}

export function interpolateColumnPrompt(
  template: string,
  task: Pick<BoardTask, 'title' | 'prompt'> & { originalPrompt?: string; description?: string }
): string {
  const original = userTaskPrompt(task);
  return template
    .replaceAll('{{title}}', cleanTitleForPrompt(task.title || ''))
    .replaceAll('{{prompt}}', original)
    .replaceAll('{{description}}', original);
}

/** Explicit follow-up wins; otherwise the column prompt; otherwise ACP defaults. */
export function resolveRunPrompt(
  column: BoardColumn | undefined,
  task: Pick<BoardTask, 'title' | 'prompt'> & { originalPrompt?: string; description?: string },
  explicitPrompt?: string
): string | undefined {
  const explicit = explicitPrompt?.trim();
  if (explicit) return explicit;
  const template = column?.prompt?.trim();
  if (template) return interpolateColumnPrompt(template, task);
  return undefined;
}

const LEGACY_COLUMN_PROMPTS: Record<string, string> = {
  plan: [
    'Read the repository and produce a concise implementation plan for this task.',
    'Do not write or edit code yet. List the files you would change, the approach, and any risks.',
    '',
    'Task: {{title}}',
    '',
    '{{prompt}}'
  ].join('\n'),
  execute: [
    'Implement this task. Follow any plan already in this conversation.',
    'Make the code changes, then summarize what you did.',
    '',
    'Task: {{title}}',
    '',
    '{{prompt}}'
  ].join('\n'),
  deliver: [
    'Review the work done in this conversation.',
    'Check for leftover todos, failing tests, and incomplete pieces.',
    'Summarize what is ready to ship and what is not. Do not start new feature work.',
    '',
    'Task: {{title}}'
  ].join('\n')
};

export function migrateLegacyColumnPrompt(column: BoardColumn): BoardColumn {
  const legacy = LEGACY_COLUMN_PROMPTS[column.id];
  if (legacy && column.prompt.trim() === legacy.trim()) {
    const fresh = DEFAULT_COLUMNS.find((item) => item.id === column.id);
    if (fresh) return { ...column, prompt: fresh.prompt };
  }
  return column;
}

export function columnConfigPatch(
  column: BoardColumn
): Partial<Pick<BoardTask, 'model' | 'agent' | 'thinkingLevel' | 'permissionMode'>> {
  const patch: Partial<Pick<BoardTask, 'model' | 'agent' | 'thinkingLevel' | 'permissionMode'>> = {};
  if (column.model) patch.model = column.model;
  if (column.agent) patch.agent = column.agent;
  if (column.thinkingLevel) patch.thinkingLevel = column.thinkingLevel;
  if (column.permissionMode) patch.permissionMode = column.permissionMode;
  return patch;
}
