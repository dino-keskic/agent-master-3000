import { ChangelogResponseResult, normalizeChangelogResponses } from '../../shared/review/agentResponses.js';
import { TaskLink } from '../../shared/types.js';
import { LEGACY_TOOL_STATUS } from './tools.js';
import {
  MoveTargets,
  SaveLinksResult,
  commentsFromTask,
  normalizeLinkInput,
  renderLinks,
  renderList,
  renderMove,
  renderOutcome,
  renderSaveOutcome,
  renderWorkspaces
} from './render.js';

/**
 * One tool call, start to finish.
 *
 * Everything the board tools do is an HTTP call back to the board the agent is
 * running under, so board state stays the single copy: a link the agent saves
 * is on the card before the tool has returned.
 *
 * Nothing here throws. A failed call comes back as an error *result*, because
 * the agent can read that and try something else, where a dead MCP server
 * would just leave it without the tools.
 */

export interface BoardMcpContext {
  boardUrl: string;
  taskId: string;
  /** The board's `BOARD_TOKEN`, when it has one. */
  token?: string;
  fetchFn?: typeof fetch;
}

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

function toolResult(text: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text }], isError };
}

async function boardRequest(
  ctx: BoardMcpContext,
  method: string,
  pathname: string,
  body?: unknown
): Promise<unknown> {
  const fetchFn = ctx.fetchFn || fetch;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (ctx.token) headers.Authorization = `Bearer ${ctx.token}`;
  const res = await fetchFn(`${ctx.boardUrl.replace(/\/+$/, '')}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { error: text };
    }
  }
  if (!res.ok) {
    const message =
      json && typeof json === 'object' && 'error' in json && typeof json.error === 'string'
        ? json.error
        : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return json;
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function workspaces(ctx: BoardMcpContext): Promise<MoveTargets> {
  return boardRequest(ctx, 'GET', `/api/tasks/${encodeURIComponent(ctx.taskId)}/move-targets`) as Promise<MoveTargets>;
}

/**
 * Send a session to another project or checkout.
 *
 * `newWorktree` is cut before the move, from the project being moved into —
 * or from where the work is now, when the move stays in the same project —
 * because a worktree only means anything next to the repo it belongs to.
 */
async function moveSession(input: Record<string, unknown>, ctx: BoardMcpContext): Promise<ToolResult> {
  const sessionId = trimmed(input.sessionId) || 'current';
  const projectId = trimmed(input.projectId);
  const newWorktree = trimmed(input.newWorktree);
  let cwd = trimmed(input.cwd);

  if (newWorktree) {
    const targets = await workspaces(ctx);
    const project = projectId ? (targets.projects || []).find((entry) => entry.id === projectId) : undefined;
    if (projectId && !project) return toolResult(`No project with id ${projectId} — call list_workspaces.`, true);
    const from = project?.path || cwd || targets.current?.cwd;
    if (!from) return toolResult('There is no repository to cut a worktree from.', true);
    const created = (await boardRequest(ctx, 'POST', '/api/worktrees', {
      cwd: from,
      name: newWorktree,
      taskId: ctx.taskId
    })) as { path?: string } | undefined;
    if (!created?.path) return toolResult('The board did not return a worktree path.', true);
    cwd = created.path;
  }

  const result = await boardRequest(
    ctx,
    'POST',
    `/api/tasks/${encodeURIComponent(ctx.taskId)}/sessions/${encodeURIComponent(sessionId)}/project`,
    { projectId: projectId || null, cwd: cwd || null }
  );
  return toolResult(renderMove(result));
}

export async function handleBoardTool(
  name: string,
  args: Record<string, unknown> | undefined,
  ctx: BoardMcpContext
): Promise<ToolResult> {
  if (!ctx.taskId) return toolResult('No task is bound to these board tools.', true);
  const input = args || {};

  try {
    if (name === 'list_changelog_comments') {
      const task = await boardRequest(ctx, 'GET', `/api/tasks/${encodeURIComponent(ctx.taskId)}`);
      const comments = commentsFromTask(task);
      const status = input.status === 'resolved' || input.status === 'all' ? input.status : 'open';
      const filtered = comments.filter((item) => {
        if (!item || typeof item !== 'object') return false;
        const resolved = !!(item as { resolvedAt?: number }).resolvedAt;
        if (status === 'resolved') return resolved;
        if (status === 'all') return true;
        return !resolved;
      });
      return toolResult(renderList(filtered, status));
    }

    if (name === 'respond_to_changelog_comments' || name in LEGACY_TOOL_STATUS) {
      // The legacy single-comment tools arrive as a bare commentId (+ body).
      const raw = name === 'respond_to_changelog_comments'
        ? input.responses
        : [{ commentId: input.commentId, reply: input.body, status: LEGACY_TOOL_STATUS[name] }];
      const responses = normalizeChangelogResponses(raw);
      if (responses.length === 0) {
        return toolResult(
          'Pass `responses`: a list of { commentId, reply?, status? } entries, one per comment you handled.',
          true
        );
      }
      const result = (await boardRequest(
        ctx,
        'POST',
        `/api/tasks/${encodeURIComponent(ctx.taskId)}/comments/respond`,
        { responses, author: 'agent' }
      )) as ChangelogResponseResult;
      return toolResult(renderOutcome(result), result.applied.length === 0);
    }

    if (name === 'list_task_links') {
      const { links } = (await boardRequest(
        ctx,
        'GET',
        `/api/tasks/${encodeURIComponent(ctx.taskId)}/links`
      )) as { links?: TaskLink[] };
      return toolResult(renderLinks(links));
    }

    if (name === 'save_task_links') {
      const inputs = normalizeLinkInput(input.links ?? input.url ?? input.link);
      if (inputs.length === 0) {
        return toolResult('Pass `links`: a list of { url, title?, note? } entries.', true);
      }
      const result = (await boardRequest(
        ctx,
        'POST',
        `/api/tasks/${encodeURIComponent(ctx.taskId)}/links`,
        { links: inputs, source: 'agent' }
      )) as SaveLinksResult;
      return toolResult(renderSaveOutcome(result), (result.added?.length || 0) + (result.updated?.length || 0) === 0);
    }

    if (name === 'remove_task_link') {
      const linkId = typeof input.linkId === 'string' ? input.linkId.trim() : '';
      if (!linkId) return toolResult('Pass `linkId` — the id from list_task_links.', true);
      await boardRequest(
        ctx,
        'DELETE',
        `/api/tasks/${encodeURIComponent(ctx.taskId)}/links/${encodeURIComponent(linkId)}`
      );
      return toolResult(`Removed ${linkId}.`);
    }

    if (name === 'list_workspaces') {
      return toolResult(renderWorkspaces(await workspaces(ctx)));
    }

    if (name === 'move_session') {
      return moveSession(input, ctx);
    }

    return toolResult(`Unknown tool: ${name}`, true);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return toolResult(message, true);
  }
}
