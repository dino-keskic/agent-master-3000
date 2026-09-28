/**
 * OpenCode sessions: finding them to import, and the several a task can hold —
 * starting, prompting, stopping and moving each one on its own.
 */

import { AcpSessionListResponse, SubagentSession } from '../../shared/sessions/types';
import { BoardTask, PromptImage, TaskLogItem } from '../../shared/types';
import { post, request } from './http';
import type { MovedTask, MoveTargetInput } from './tasks';

export interface SessionQuery {
  query?: string;
  includeUntitled?: boolean;
  includeRemoved?: boolean;
  live?: boolean;
  cwd?: string;
  /** How many sessions to send back; `total` still counts them all. */
  limit?: number;
}

export interface StartSessionInput {
  mode: 'fork' | 'new';
  /** Required for a fork: the question you are asking the copy. */
  prompt?: string;
  /** Images dropped into the prompt box the session starts with. */
  images?: PromptImage[];
  title?: string;
  model?: string;
  agent?: string;
  thinkingLevel?: string;
  /** Which session to copy; defaults to the one currently on screen. */
  sourceSessionId?: string;
  /** Blank sessions can run in another project than the task. */
  cwd?: string;
  projectId?: string;
}

const sessionPath = (taskId: string, sessionId: string) =>
  `/api/tasks/${taskId}/sessions/${encodeURIComponent(sessionId)}`;

export const sessionsApi = {
  listSessions: ({ query, includeUntitled, includeRemoved, live, cwd, limit }: SessionQuery = {}) => {
    const params = new URLSearchParams();
    if (query?.trim()) params.set('q', query.trim());
    if (includeUntitled) params.set('untitled', '1');
    if (includeRemoved) params.set('removed', '1');
    if (live) params.set('live', '1');
    if (cwd) params.set('cwd', cwd);
    if (limit) params.set('limit', String(limit));
    return request<AcpSessionListResponse>(`/api/acp/sessions?${params.toString()}`);
  },

  importSession: (sessionId: string, scopeCwd?: string) =>
    post<BoardTask>('/api/tasks/from-session', { sessionId, scopeCwd }),

  /**
   * Start another session on this task.
   *
   * `fork` copies an existing session, so the new one carries its whole
   * conversation — this is the "BTW" side chat. `new` starts blank and becomes
   * the session plain follow-ups target.
   */
  startSession: (taskId: string, input: StartSessionInput) =>
    post<BoardTask>(`/api/tasks/${taskId}/sessions`, input),

  /**
   * What one session runs as. Per session, so picking a model in a fork does
   * not re-model the task's main conversation.
   */
  setSessionSettings: (
    taskId: string,
    sessionId: string,
    settings: { model?: string; agent?: string; thinkingLevel?: string }
  ) => post<BoardTask>(`${sessionPath(taskId, sessionId)}/settings`, settings),

  /** Switch active viewed session for this task in the drawer. */
  switchSession: (taskId: string, sessionId: string) =>
    post<BoardTask>(`/api/tasks/${taskId}/sessions/switch`, { sessionId }),

  /** Fetch transcript logs for a specific linked session. */
  getSessionHistory: (taskId: string, sessionId: string) =>
    request<{ sessionId: string; logs: TaskLogItem[]; model?: string; agent?: string }>(
      `${sessionPath(taskId, sessionId)}/history`
    ),

  /** Child OpenCode sessions of every linked session on this task. */
  listTaskSubagents: (taskId: string) =>
    request<Record<string, SubagentSession[]>>(`/api/tasks/${taskId}/subagents`),

  /** Send a prompt to a specific linked session. */
  promptSession: (taskId: string, sessionId: string, prompt: string, images?: PromptImage[]) =>
    post<BoardTask>(`${sessionPath(taskId, sessionId)}/prompt`, { prompt, images }),

  /** Stop the turn in one session, leaving the task's other sessions running. */
  stopSession: (taskId: string, sessionId: string) =>
    post<BoardTask>(`${sessionPath(taskId, sessionId)}/stop`),

  /** Make a linked session the one plain follow-ups and column runs target. */
  promoteSession: (taskId: string, sessionId: string) =>
    post<BoardTask>(`${sessionPath(taskId, sessionId)}/promote`),

  /** Move one session on its own — an empty target puts it back on the task's. */
  moveSessionToProject: (taskId: string, sessionId: string, target: MoveTargetInput) =>
    post<MovedTask>(`${sessionPath(taskId, sessionId)}/project`, target),

  /** Summarize one session so it can keep going with a smaller context. */
  compactSession: (taskId: string, sessionId: string) =>
    post<BoardTask>(`${sessionPath(taskId, sessionId)}/compact`)
};
