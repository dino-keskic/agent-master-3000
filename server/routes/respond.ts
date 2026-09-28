import { Express, Request, Response } from 'express';
import { newId } from '../../shared/ids.js';
import { isApproval } from '../../shared/agent/permissions.js';
import { listTaskSessions } from '../../shared/task/sessions.js';
import { PendingRequest, PermissionAnswer } from '../../shared/types.js';
import { acpManager } from '../acp/client.js';
import { IdParams } from '../http/app.js';
import { taskStore } from '../board/taskStore.js';
import { RouteContext } from './context.js';

/**
 * Answering an agent that is blocked on the user.
 *
 * The JSON-RPC id stays open on the ACP connection until the answer lands, so
 * this route is the far end of a turn that is currently suspended mid-call.
 */

/**
 * The permission timeline is the audit trail for the one feature that gates
 * destructive commands, so it records *what* was allowed or rejected — not just
 * that something was answered.
 */
function describePermissionAnswer(asked: PendingRequest | undefined, optionId: string): string {
  if (!asked || asked.type !== 'permission') return `You answered a permission request (${optionId}).`;

  const chosen = asked.options.find((option) => option.optionId === optionId);
  const verb = chosen ? (isApproval(chosen.kind) ? 'Allowed' : 'Rejected') : 'Answered';
  const label = chosen?.name ? ` (${chosen.name})` : '';
  const command = commandOf(asked.toolCall);
  const what = command ? `${asked.toolCall.name}: ${command}` : asked.toolCall.name;
  return `${verb}${label} — ${what}`;
}

function commandOf(toolCall: { rawInput?: Record<string, unknown> }): string | undefined {
  const input = toolCall.rawInput;
  if (!input) return undefined;
  for (const key of ['command', 'cmd', 'path', 'file_path', 'filePath']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      return value.length > 200 ? `${value.slice(0, 200)}…` : value;
    }
  }
  return undefined;
}

/** What the agent's answer is recorded as in the transcript. */
function describeQuestionAnswer(answer: Extract<PermissionAnswer, { kind: 'question' }>): string {
  if (answer.action === 'accept') return "You answered the agent's question.";
  return `You ${answer.action === 'decline' ? 'declined' : 'cancelled'} the agent's question.`;
}

/** Answering a permission request or a question the agent is blocked on. */
export function registerRespondRoutes(app: Express, { publisher }: RouteContext): void {
  app.post('/api/tasks/:id/respond', (req: Request<IdParams>, res: Response) => {
    const { id } = req.params;
    const task = taskStore.getTask(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const answer = req.body as PermissionAnswer;
    if (!answer?.requestId || (answer.kind !== 'permission' && answer.kind !== 'question')) {
      return res.status(400).json({ error: 'A requestId and kind ("permission" or "question") are required' });
    }

    // Two sessions of one task can be blocked at once, so the answer is matched
    // against every session's parked request — not just the task's first one.
    const blocked = listTaskSessions(task).find((link) => link.pendingRequest?.requestId === answer.requestId);
    const asked = blocked?.pendingRequest
      ?? (task.pendingRequest?.requestId === answer.requestId ? task.pendingRequest : undefined);
    if (!asked) {
      return res.status(409).json({ error: 'That request is no longer waiting for an answer' });
    }
    const blockedSessionId = blocked?.sessionId ?? acpManager.sessionForPendingRequest(answer.requestId);

    const delivered = acpManager.resolvePendingRequest(answer);
    if (!delivered) {
      taskStore.setSessionPendingRequest(id, blockedSessionId, undefined);
      return res.status(409).json({ error: 'That request was already answered or the agent moved on' });
    }

    // Parallel tool calls park several requests on one session, and the board
    // shows them one at a time. The next one takes this one's place; clearing
    // the slot instead would leave the agent blocked on a request nobody sees.
    const next = acpManager.pendingRequestFor(id, blockedSessionId);
    taskStore.setSessionPendingRequest(id, blockedSessionId, next);
    const resumed = (next
      ? taskStore.getTask(id)
      : blockedSessionId
        ? taskStore.setSessionRunState(id, blockedSessionId, 'running')
        : taskStore.setRunState(id, 'running')) || task;
    taskStore.addLogToTask(id, {
      id: newId(),
      timestamp: Date.now(),
      type: 'info',
      title: 'Answered',
      text: answer.kind === 'permission'
        ? describePermissionAnswer(asked, answer.optionId)
        : describeQuestionAnswer(answer),
      sessionId: blockedSessionId
    });

    res.json(publisher.status(taskStore.getTask(id) || resumed));
  });
}
