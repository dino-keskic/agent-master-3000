import { listTaskSessions, sessionCwd } from '../../shared/task/sessions.js';
import { acpManager } from '../acp/client.js';
import { attachChangeSummary } from '../board/queries.js';
import { BoardPublisher } from '../live/publisher.js';
import { taskStore } from '../board/taskStore.js';
import { TurnOrchestrator } from './orchestrator.js';

/**
 * The bridge from the ACP manager's events to board state.
 *
 * The manager knows what the agent said; it does not know what a board task is.
 * Everything that turns one into the other lives here.
 */
export function registerAcpEvents(publisher: BoardPublisher, orchestrator: TurnOrchestrator): void {
  acpManager.setFolderResolver((taskId, sessionId) => {
    const task = taskStore.getTask(taskId);
    if (!task) return undefined;
    return sessionCwd(task, listTaskSessions(task).find((link) => link.sessionId === sessionId));
  });

  acpManager.setEventCallback((taskId, event) => {
    const task = taskStore.getTask(taskId);
    const sessionId = event.sessionId;

    if (event.type === 'session_bound' && event.sessionId) {
      const updated = event.primary === false
        ? taskStore.setSessionRunState(taskId, event.sessionId, 'running')
        : taskStore.updateTask(taskId, { sessionId: event.sessionId });
      if (updated) publisher.updated(updated);
      return;
    }

    if (event.type === 'session_info' && event.sessionId && event.title) {
      const updated = taskStore.adoptSessionTitle(taskId, event.sessionId, event.title);
      if (updated) publisher.updated(updated);
      return;
    }

    if (event.type === 'awaiting_input' && event.request) {
      const updated = taskStore.setSessionPendingRequest(taskId, sessionId, event.request);
      if (updated) publisher.awaitingInput(taskId, updated, event.request);
      return;
    }

    /**
     * Logs are accepted per session: with a fork running alongside the main
     * conversation, one of them being blocked or idle must not silence the
     * other. Sessions with no link of their own (subagents) fall back to the
     * task.
     */
    const link = sessionId ? task?.sessions?.find((s) => s.sessionId === sessionId) : undefined;
    const sessionRunning = link ? link.runState === 'running' : task?.runState === 'running';
    const acceptLogs = task && (sessionRunning || acpManager.isImporting(taskId));
    if (!acceptLogs && event.type !== 'status_change' && event.type !== 'error') return;

    if (event.type === 'log' && event.log) {
      publisher.log(taskId, event.log);
      return;
    }

    if (event.type === 'status_change') {
      if (event.log) publisher.log(taskId, event.log);
      orchestrator.drainOrIdle(taskId, sessionId);
      return;
    }

    if (event.type === 'error') {
      taskStore.setSessionPendingRequest(taskId, sessionId, undefined);
      if (event.log) publisher.log(taskId, event.log);
      const updated = sessionId
        ? taskStore.setSessionError(taskId, sessionId, event.error) &&
          taskStore.setSessionRunState(taskId, sessionId, 'error')
        : taskStore.setRunState(taskId, 'error') && taskStore.updateTask(taskId, { error: event.error });
      const finalTask = attachChangeSummary(taskId) || updated;
      if (finalTask) {
        publisher.failed(taskId, event.error || 'The agent reported an error without a message', finalTask);
      }
    }
  });
}
