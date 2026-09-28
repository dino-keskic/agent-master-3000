import { BoardTask, PendingPermission, PendingQuestion, TaskSessionLink } from '../../shared/types.js';

/** A resting task, a session link, and the two things that block a turn. */

export function task(overrides: Partial<BoardTask> = {}): BoardTask {
  return {
    id: 'TASK-1',
    title: 'Ship the thing',
    description: '',
    prompt: 'do it',
    columnId: 'execute',
    runState: 'idle',
    model: 'anthropic/claude',
    agent: 'build',
    thinkingLevel: 'default',
    cwd: '/repo',
    createdAt: 1_000,
    updatedAt: 2_000,
    logs: [],
    ...overrides
  };
}

export function link(overrides: Partial<TaskSessionLink> & { sessionId: string }): TaskSessionLink {
  return {
    title: 'Session',
    kind: 'main',
    createdAt: 1_000,
    ...overrides
  };
}

export const permission: PendingPermission = {
  type: 'permission',
  requestId: 'req-1',
  askedAt: 10,
  toolCall: {
    toolCallId: 'tc-1',
    name: 'bash',
    kind: 'execute',
    status: 'pending',
    rawInput: { command: 'npm test' }
  },
  options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }]
};

export const question: PendingQuestion = {
  type: 'question',
  requestId: 'q-1',
  askedAt: 10,
  message: 'Which branch should I use?',
  mode: 'form',
  fields: []
};
