import { ActiveToolCall, BoardTask, ToolCallInfo } from '../types.js';
import { isSessionBusy, listTaskSessions, sessionCwd, sessionRunState } from '../task/sessions.js';
import { toolKind } from './toolCall.js';

/**
 * In-flight tool calls across the board. List and push payloads omit
 * transcripts, so the server stamps `task.activeTools` on the way out; the
 * client also folds live `TASK_LOG` deltas into `task.logs`. This merges both
 * so a completed delta drops a tool the snapshot still listed.
 */

const LIVE: ReadonlySet<ToolCallInfo['status']> = new Set(['pending', 'in_progress']);

/** Drop streamed output — the background list only needs identity and input. */
export function slimToolCall(info: ToolCallInfo): ToolCallInfo {
  if (!info.output) return info;
  const { output: _output, ...rest } = info;
  return rest;
}

export function collectActiveTools(task: Pick<BoardTask, 'logs' | 'activeTools'>): ActiveToolCall[] {
  const fromLogs = new Map<string, ActiveToolCall>();
  const known = new Set<string>();

  for (const log of task.logs) {
    if (!log.toolCall) continue;
    known.add(log.toolCall.toolCallId);
    if (LIVE.has(log.toolCall.status)) {
      fromLogs.set(log.toolCall.toolCallId, {
        toolCall: slimToolCall(log.toolCall),
        sessionId: log.sessionId,
        startedAt: log.timestamp
      });
    }
  }

  const result = [...fromLogs.values()];
  for (const tool of task.activeTools || []) {
    if (!known.has(tool.toolCall.toolCallId)) result.push(tool);
  }
  return result;
}

export interface BackgroundTaskItem {
  taskId: string;
  taskTitle: string;
  projectName?: string;
  sessionId?: string;
  sessionTitle?: string;
  toolCall: ToolCallInfo;
  startedAt: number;
}

function sessionTitle(task: BoardTask, sessionId: string | undefined): string | undefined {
  if (!sessionId) return undefined;
  return listTaskSessions(task).find((link) => link.sessionId === sessionId)?.title;
}

/**
 * Execute/shell first (those are the ones that keep running while you look
 * away), then everything else still in flight, newest start last so a just-
 * kicked-off command is on top.
 */
export function listBackgroundTasks(tasks: BoardTask[]): BackgroundTaskItem[] {
  const items: BackgroundTaskItem[] = [];
  for (const task of tasks) {
    const sessions = listTaskSessions(task);
    for (const tool of collectActiveTools(task)) {
      const session = tool.sessionId
        ? sessions.find((link) => link.sessionId === tool.sessionId)
        : sessions[0];
      const state = session ? sessionRunState(task, session) : task.runState;
      // A tool left in_progress when the turn ended is not still running.
      if (!isSessionBusy(state)) continue;
      items.push({
        taskId: task.id,
        taskTitle: task.title,
        projectName: task.projectName,
        sessionId: tool.sessionId,
        sessionTitle: sessionTitle(task, tool.sessionId),
        toolCall: tool.toolCall,
        startedAt: tool.startedAt
      });
    }
  }
  return items.sort((a, b) => {
    const aExec = isExecuteTool(a.toolCall) ? 0 : 1;
    const bExec = isExecuteTool(b.toolCall) ? 0 : 1;
    if (aExec !== bExec) return aExec - bExec;
    return b.startedAt - a.startedAt;
  });
}

export function isExecuteTool(info: Pick<ToolCallInfo, 'kind' | 'name'>): boolean {
  if ((info.kind || '').toLowerCase() === 'execute') return true;
  return toolKind(info.name) === 'execute';
}

/** The shell string the agent actually ran, when the tool reported one. */
export function executeCommand(info: Pick<ToolCallInfo, 'rawInput'>): string | undefined {
  const input = info.rawInput;
  if (!input) return undefined;
  for (const key of ['command', 'cmd']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * What Stop needs to find leftover OS processes: every execute command this
 * work ran (backgrounded bash completes the tool call while the process keeps
 * going), and the folders those shells were started in.
 */
export function processKillSpec(
  task: BoardTask,
  sessionIds?: string[]
): { commands: string[]; cwds: string[] } {
  const scope = sessionIds ? new Set(sessionIds) : undefined;
  const inScope = (sessionId: string | undefined) => !scope || !sessionId || scope.has(sessionId);

  const commands: string[] = [];
  const seen = new Set<string>();
  const addCommand = (info: ToolCallInfo | undefined) => {
    if (!info || !isExecuteTool(info)) return;
    const command = executeCommand(info);
    if (!command || seen.has(command)) return;
    seen.add(command);
    commands.push(command);
  };

  for (const tool of collectActiveTools(task)) {
    if (inScope(tool.sessionId)) addCommand(tool.toolCall);
  }
  for (const log of task.logs) {
    if (inScope(log.sessionId)) addCommand(log.toolCall);
  }

  const cwds: string[] = [];
  const cwdSeen = new Set<string>();
  const addCwd = (cwd: string | undefined) => {
    const folder = cwd?.replace(/\/+$/, '');
    if (!folder || cwdSeen.has(folder)) return;
    cwdSeen.add(folder);
    cwds.push(folder);
  };
  for (const session of listTaskSessions(task)) {
    if (scope && !scope.has(session.sessionId)) continue;
    addCwd(sessionCwd(task, session));
  }
  if (cwds.length === 0) addCwd(task.cwd);

  return { commands, cwds };
}

function inputString(input: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!input) return undefined;
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      const compact = value.length > 88 ? `${value.slice(0, 88)}…` : value;
      return key === 'filePath' || key === 'path' ? compact.split('/').slice(-2).join('/') : compact;
    }
  }
  return undefined;
}

/** One-line gist: a shell command, a path, a pattern. */
export function toolCallSummary(info: ToolCallInfo): string | undefined {
  if (isExecuteTool(info)) {
    const command = inputString(info.rawInput, ['command', 'cmd']);
    if (command) return command;
  }
  if (info.locations && info.locations.length > 0) {
    const first = (info.locations[0] ?? '').split('/').slice(-2).join('/');
    return info.locations.length > 1 ? `${first} +${info.locations.length - 1} more` : first;
  }
  return inputString(info.rawInput, ['command', 'cmd', 'filePath', 'path', 'pattern', 'query', 'url', 'description']);
}
