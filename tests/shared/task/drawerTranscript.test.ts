import test from 'node:test';
import assert from 'node:assert';
import {
  blankSessionPending,
  drawerTranscript,
  initialPromptLog,
  initialPromptLogId
} from '../../../shared/task/drawerTranscript.js';
import { BoardTask, TaskLogItem } from '../../../shared/types.js';

function task(overrides: Partial<BoardTask> = {}): BoardTask {
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

function log(overrides: Partial<TaskLogItem> & { id: string }): TaskLogItem {
  return { timestamp: 2_000, type: 'agent_say', text: 'hi', ...overrides };
}

test('a task with no session shows its prompt before anything runs', () => {
  const shown = drawerTranscript(task(), undefined, undefined);
  assert.deepStrictEqual(shown.map((l) => [l.id, l.type, l.text]), [[initialPromptLogId('TASK-1'), 'user_say', 'do it']]);
});

test('the prompt stays when starting the agent failed and only errors were logged', () => {
  const shown = drawerTranscript(task({ logs: [log({ id: 'e1', type: 'error', text: 'OpenCode quit' })] }), undefined, undefined);
  assert.deepStrictEqual(shown.map((l) => l.id), [initialPromptLogId('TASK-1'), 'e1']);
});

test('no stand-in once a session exists or the prompt was echoed', () => {
  assert.strictEqual(initialPromptLog(task({ sessionId: 'ses_1' })), undefined);
  const echoed = task({ logs: [log({ id: 'u1', type: 'user_say', text: 'do it' })] });
  assert.deepStrictEqual(drawerTranscript(echoed, undefined, undefined).map((l) => l.id), ['u1']);
});

test('an empty prompt has no stand-in, but images alone do', () => {
  assert.strictEqual(initialPromptLog(task({ prompt: '  ' })), undefined);
  const img = { mime: 'image/png', data: 'AAAA' } as unknown as NonNullable<BoardTask['promptImages']>[number];
  assert.strictEqual(initialPromptLog(task({ prompt: '', promptImages: [img] }))?.images?.length, 1);
});

test('a blank session is empty from the click until the task moves to it', () => {
  const old = task({
    sessionId: 'ses_old',
    logs: [log({ id: 'a', sessionId: 'ses_old' }), log({ id: 'b', sessionId: 'ses_old', type: 'user_say' })]
  });
  const start = { fromSessionId: 'ses_old' };
  assert.strictEqual(blankSessionPending(old, start), true);
  assert.deepStrictEqual(drawerTranscript(old, 'ses_old', undefined, start), []);

  const moved = { ...old, sessionId: 'ses_new' };
  assert.strictEqual(blankSessionPending(moved, start), false);
  assert.deepStrictEqual(drawerTranscript(moved, 'ses_new', undefined, start), []);
  assert.deepStrictEqual(drawerTranscript(old, 'ses_old', undefined, undefined).map((l) => l.id), ['a', 'b']);
});
