/**
 * The manager's board tools: reading every task, and sending one a message.
 *
 * Like the task tools in `handler.ts`, each is an HTTP call back to the board,
 * so what the manager reads is what the board shows. The digest is made on the
 * server (`/api/manager/...`) and turned into text here, by
 * `shared/manager/render.ts`.
 */

import { BoardDigest, TaskDetail } from '../../shared/manager/digest.js';
import { isManagerTask } from '../../shared/manager/identity.js';
import { renderBoardDigest, renderTaskDetail } from '../../shared/manager/render.js';
import { BoardMcpContext, ToolResult, boardRequest, toolResult } from './request.js';
import { MANAGER_TOOLS } from './tools.js';

const MANAGER_TOOL_NAMES = new Set<string>(MANAGER_TOOLS.map((tool) => tool.name));

export function isManagerTool(name: string): boolean {
  return MANAGER_TOOL_NAMES.has(name);
}

/** More than this and the "recent" conversation is a transcript again. */
const MAX_TURNS = 30;

function taskIdOf(input: Record<string, unknown>): string {
  return typeof input.taskId === 'string' ? input.taskId.trim().toUpperCase() : '';
}

export async function handleManagerTool(
  name: string,
  input: Record<string, unknown>,
  ctx: BoardMcpContext
): Promise<ToolResult> {
  try {
    if (name === 'board_overview') {
      const digest = (await boardRequest(ctx, 'GET', '/api/manager/overview')) as BoardDigest;
      return toolResult(renderBoardDigest(digest));
    }

    const taskId = taskIdOf(input);
    if (!taskId) return toolResult('Pass `taskId` — an id from board_overview.', true);
    if (isManagerTask(taskId)) return toolResult('That is your own task; pick one from board_overview.', true);

    if (name === 'task_detail') {
      const turns = typeof input.turns === 'number' && input.turns > 0 ? Math.min(Math.floor(input.turns), MAX_TURNS) : 8;
      const detail = (await boardRequest(
        ctx,
        'GET',
        `/api/manager/tasks/${encodeURIComponent(taskId)}?turns=${turns}`
      )) as TaskDetail & { now: number };
      return toolResult(renderTaskDetail(detail, detail.now));
    }

    if (name === 'prompt_task') {
      const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
      if (!prompt) return toolResult('Pass `prompt` — the message for that task.', true);
      const task = (await boardRequest(ctx, 'POST', `/api/tasks/${encodeURIComponent(taskId)}/prompt`, { prompt })) as {
        runState?: string;
        queued?: unknown[];
      };
      const queued = task.queued?.length ? ` It is queued behind the running turn (${task.queued.length} waiting).` : '';
      return toolResult(`Sent to ${taskId}.${queued}`);
    }

    return toolResult(`Unknown tool: ${name}`, true);
  } catch (e) {
    return toolResult(e instanceof Error ? e.message : String(e), true);
  }
}
