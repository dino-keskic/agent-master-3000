/**
 * Agent plan extraction and tracking (`todowrite`).
 *
 * OpenCode agents use `todowrite` (and related todo tools) to maintain an
 * explicit checklist of steps. This module parses those tool calls into a
 * structured plan, tracking active step, progress, and checklist items.
 */

import { TaskLogItem } from '../types.js';

export type TodoStatus = 'completed' | 'in_progress' | 'pending' | 'blocked' | 'cancelled';

export interface TodoItem {
  id: string;
  label: string;
  status: TodoStatus;
  meta?: string;
}

export interface TodoPlan {
  items: TodoItem[];
  doneCount: number;
  runningCount: number;
  pendingCount: number;
  blockedCount: number;
  totalCount: number;
  /** Active step: the in_progress item, or the next pending item. */
  activeItem?: TodoItem;
  /** 1-based index of the active step out of totalCount (e.g. 4 for 4/7). */
  activeStepNumber: number;
  /** Completion percentage (0 - 100). */
  progressPercent: number;
}

function normalizeStatus(rawStatus: unknown, done?: boolean): TodoStatus {
  if (done === true) return 'completed';
  if (typeof rawStatus !== 'string') return 'pending';
  const s = rawStatus.toLowerCase().trim();
  if (s === 'completed' || s === 'done' || s === 'finished') return 'completed';
  if (s === 'in_progress' || s === 'running' || s === 'active') return 'in_progress';
  if (s === 'blocked') return 'blocked';
  if (s === 'cancelled' || s === 'skipped') return 'cancelled';
  return 'pending';
}

export function parseTodoRawInput(rawInput: unknown): TodoPlan | undefined {
  if (!rawInput || typeof rawInput !== 'object') return undefined;

  let rawList: unknown[] | undefined;
  if (Array.isArray(rawInput)) {
    rawList = rawInput;
  } else {
    const record = rawInput as Record<string, unknown>;
    if (Array.isArray(record.todos)) rawList = record.todos;
    else if (Array.isArray(record.items)) rawList = record.items;
    else if (Array.isArray(record.tasks)) rawList = record.tasks;
    else if (Array.isArray(record.plan)) rawList = record.plan;
  }

  if (!rawList || rawList.length === 0) return undefined;

  const items: TodoItem[] = [];
  rawList.forEach((entry, idx) => {
    if (!entry || typeof entry !== 'object') return;
    const item = entry as Record<string, unknown>;
    const label = (
      (typeof item.content === 'string' && item.content) ||
      (typeof item.label === 'string' && item.label) ||
      (typeof item.text === 'string' && item.text) ||
      (typeof item.title === 'string' && item.title) ||
      (typeof item.task === 'string' && item.task) ||
      ''
    ).trim();

    if (!label) return;

    const id = typeof item.id === 'string' && item.id ? item.id : `todo-${idx + 1}`;
    const status = normalizeStatus(item.status, item.done === true || item.completed === true);
    const meta = (typeof item.meta === 'string' && item.meta) ||
      (typeof item.duration === 'string' && item.duration) ||
      (typeof item.priority === 'string' && item.priority) ||
      undefined;

    items.push({ id, label, status, meta });
  });

  if (items.length === 0) return undefined;

  const doneCount = items.filter((i) => i.status === 'completed').length;
  const runningCount = items.filter((i) => i.status === 'in_progress').length;
  const blockedCount = items.filter((i) => i.status === 'blocked').length;
  const pendingCount = items.filter((i) => i.status === 'pending').length;
  const totalCount = items.length;

  const activeItem = items.find((i) => i.status === 'in_progress') ||
    items.find((i) => i.status === 'pending');

  const activeStepNumber = activeItem
    ? items.indexOf(activeItem) + 1
    : doneCount >= totalCount
      ? totalCount
      : 1;

  const progressPercent = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  return {
    items,
    doneCount,
    runningCount,
    pendingCount,
    blockedCount,
    totalCount,
    activeItem,
    activeStepNumber,
    progressPercent
  };
}

const TODO_TOOL_NAMES = new Set(['todowrite', 'todo', 'write_todos', 'writetodos', 'update_todos']);

/**
 * Scan logs in reverse to locate the latest todowrite tool call and parse its plan.
 */
export function extractTodoPlan(logs: TaskLogItem[] | undefined): TodoPlan | undefined {
  if (!logs || logs.length === 0) return undefined;

  for (let i = logs.length - 1; i >= 0; i--) {
    const log = logs[i];
    if (log?.type !== 'tool_call' || !log.toolCall) continue;
    const name = (log.toolCall.name || '').toLowerCase();
    if (TODO_TOOL_NAMES.has(name)) {
      const plan = parseTodoRawInput(log.toolCall.rawInput);
      if (plan && plan.items.length > 0) return plan;
    }
  }

  return undefined;
}
