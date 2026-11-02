import test from 'node:test';
import assert from 'node:assert';
import { patchTask } from '../../../shared/task/factory.js';
import { sessionRunSettings } from '../../../shared/task/sessions.js';
import { BoardTask, TaskSessionLink } from '../../../shared/types.js';

function link(overrides: Partial<TaskSessionLink>): TaskSessionLink {
  return {
    sessionId: 'ses_main',
    title: 'Main',
    kind: 'main',
    origin: 'initial',
    createdAt: 1,
    updatedAt: 1,
    model: 'm1',
    agent: 'build',
    thinkingLevel: 'low',
    ...overrides
  };
}

function task(sessions: TaskSessionLink[]): BoardTask {
  return {
    id: 'TASK-1',
    title: 'Ship it',
    description: '',
    prompt: '',
    columnId: 'execute',
    runState: 'idle',
    cwd: '/repo',
    logs: [],
    createdAt: 1,
    updatedAt: 1,
    model: 'm1',
    agent: 'build',
    thinkingLevel: 'low',
    sessionId: 'ses_main',
    sessions
  };
}

test('a thinking change on the task beats the primary session\'s own pick', () => {
  const before = task([link({ chosen: { thinkingLevel: 'high', model: 'm2' }, thinkingLevel: 'high', model: 'm2' })]);
  const after = patchTask(before, { thinkingLevel: 'max' });
  const main = after.sessions![0]!;
  assert.deepStrictEqual(main.chosen, { model: 'm2' });
  assert.strictEqual(main.thinkingLevel, 'max');
  assert.strictEqual(sessionRunSettings(after, main.chosen).thinkingLevel, 'max');
  // The task as it was is left alone.
  assert.strictEqual(before.sessions![0]!.chosen?.thinkingLevel, 'high');
});

test('a side session keeps its own pick and follows the task in the rest', () => {
  const side = link({ sessionId: 'ses_side', kind: 'btw', chosen: { thinkingLevel: 'high' }, thinkingLevel: 'high' });
  const plain = link({ sessionId: 'ses_plain', kind: 'btw' });
  const after = patchTask(task([link({}), side, plain]), { thinkingLevel: 'max', agent: 'plan' });
  const [, s, p] = after.sessions as [TaskSessionLink, TaskSessionLink, TaskSessionLink];
  assert.strictEqual(s.thinkingLevel, 'high');
  assert.strictEqual(s.agent, 'plan');
  assert.strictEqual(p.thinkingLevel, 'max');
});

test('a patch that touches no run setting leaves the sessions as they were', () => {
  const before = task([link({ chosen: { thinkingLevel: 'high' } })]);
  const after = patchTask(before, { title: 'Renamed' });
  assert.strictEqual(after.sessions, before.sessions);
});
