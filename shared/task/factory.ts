import { BoardTask, GlobalSettings } from '../types.js';
import { clipText } from '../sessions/list.js';
import { newId } from '../ids.js';
import { findColumn, resolveColumnId } from '../board/columns.js';
import { buildTaskLink, mergeTaskLinks } from './links.js';
import { linksInPrompt } from './promptLinks.js';
import { trimTaskLogs } from './logWrites.js';

/**
 * Making a task, and patching one.
 *
 * Both are here because they answer the same question from two directions:
 * which fields a caller is allowed to set, and which ones the board owns.
 */

export type NewTaskInput = Partial<BoardTask> & { title: string; prompt: string };

/** Fields a PATCH may set. Everything else about a task is the board's to move. */
const PATCHABLE_TASK_FIELDS = new Set([
  'title',
  'titleLocked',
  'description',
  'prompt',
  'model',
  'agent',
  'thinkingLevel',
  'permissionMode',
  'cwd',
  'projectId',
  'sessionId',
  'sessions',
  'activeSessionId',
  'error',
  'lastMessage',
  'lastUserMessage',
  'changeSummary',
  'tokenCount',
  'cost',
  'contextTokens',
  'contextLimit'
]);

/** A new task, with the board's defaults filled in and the id already chosen. */
export function buildTask(input: NewTaskInput, settings: GlobalSettings, id: string): BoardTask {
  const columnId = resolveColumnId(settings.columns, input.columnId);
  const column = findColumn(settings.columns, columnId);
  const columnTitle = column?.title || columnId;
  const now = Date.now();
  const model = input.model || settings.defaultModel;
  const agent = input.agent || settings.defaultAgent;

  const task: BoardTask = {
    id,
    title: input.title,
    prompt: input.prompt,
    originalPrompt: input.originalPrompt || input.prompt,
    promptImages: input.promptImages?.length ? [...input.promptImages] : undefined,
    description: input.description || input.prompt,
    columnId,
    runState: 'idle',
    model,
    agent,
    thinkingLevel: input.thinkingLevel || settings.defaultThinkingLevel,
    permissionMode: input.permissionMode || settings.defaultPermissionMode,
    sessionId: input.sessionId,
    sessions: input.sessions ? [...input.sessions] : (input.sessionId ? [{
      sessionId: input.sessionId,
      title: input.title,
      kind: 'main',
      createdAt: now,
      stageColumnId: columnId,
      prompt: input.prompt,
      model,
      agent
    }] : []),
    activeSessionId: input.activeSessionId || input.sessionId,
    cwd: input.cwd || settings.defaultCwd,
    projectId: input.projectId || settings.selectedProjectId,
    lastUserMessage: clipText(input.lastUserMessage || input.prompt),
    lastMessage: input.lastMessage,
    tokenCount: input.tokenCount,
    cost: input.cost,
    contextTokens: input.contextTokens,
    contextLimit: input.contextLimit,
    changeSummary: input.changeSummary,
    createdAt: now,
    updatedAt: now,
    logs: [
      {
        id: newId(),
        timestamp: now,
        type: 'info',
        title: 'Task Created',
        text: `Task added to ${columnTitle}.`
      },
      ...(input.logs || [])
    ]
  };

  // Whatever the task was opened against — the ticket, the PR, the red CI run,
  // the thread — is part of the task, so it is read out of the text it was
  // created with rather than left in the prompt.
  const seeded = mergeTaskLinks(
    input.links,
    linksInPrompt(task.description).flatMap((link) => {
      const built = buildTaskLink(link, newId(), 'prompt');
      return built ? [built] : [];
    })
  ).links;
  if (seeded.length > 0) task.links = seeded;

  trimTaskLogs(task);
  return task;
}

/**
 * The task as it looks after a PATCH. Id, column, run state and transcript are
 * the board's own, and a title the user typed must not be overwritten later by
 * an OpenCode session rename.
 */
export function patchTask(current: BoardTask, updates: Partial<BoardTask>): BoardTask {
  const next: Partial<BoardTask> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (PATCHABLE_TASK_FIELDS.has(key)) {
      (next as Record<string, unknown>)[key] = value;
    }
  }

  const updated: BoardTask = {
    ...current,
    ...next,
    id: current.id,
    columnId: current.columnId,
    runState: current.runState,
    logs: current.logs,
    createdAt: current.createdAt,
    updatedAt: Date.now()
  };
  if (
    typeof next.title === 'string'
    && next.title !== current.title
    && next.titleLocked === undefined
  ) {
    updated.titleLocked = true;
  }
  return updated;
}
