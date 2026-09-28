import test from 'node:test';
import assert from 'node:assert';
import { TurnRegistry, turnKey, turnTargetSession } from '../../../server/turns/registry.js';
import { BoardTask } from '../../../shared/types.js';

function task(overrides: Partial<BoardTask> = {}): BoardTask {
  return {
    id: 'TASK-1',
    title: 'A task',
    prompt: 'do the thing',
    columnId: 'todo',
    runState: 'idle',
    cwd: '/repo',
    logs: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  } as BoardTask;
}

test('a turn with no session yet is keyed on the task until one exists', () => {
  assert.strictEqual(turnKey('TASK-1'), 'new:TASK-1');
  assert.strictEqual(turnKey('TASK-1', 'ses_1'), 'ses_1');
});

test('the target session is the explicit one, then the task, then nothing', () => {
  const withSession = task({ sessionId: 'ses_main' });

  assert.strictEqual(turnTargetSession(withSession, { sessionId: 'ses_fork' }), 'ses_fork');
  assert.strictEqual(turnTargetSession(withSession), 'ses_main');
  // A deliberate restart has no session to aim at — the turn creates one.
  assert.strictEqual(turnTargetSession(withSession, { newSession: true }), undefined);
  assert.strictEqual(turnTargetSession(task()), undefined);
});

test('a fork and the main session are separately busy', () => {
  const turns = new TurnRegistry();
  turns.beginStart('ses_main', 'main prompt');

  assert.ok(turns.isStarting('ses_main'));
  assert.ok(!turns.isStarting('ses_fork'), 'a side chat must not wait on the main thread');

  turns.endStart('ses_main');
  assert.ok(!turns.isStarting('ses_main'));
});

test('re-sending the prompt a turn is already carrying is not a follow-up', () => {
  const turns = new TurnRegistry();
  turns.beginStart('ses_1', 'fix the build');

  assert.ok(turns.isAlreadyRunning('ses_1', 'fix the build'));
  assert.ok(!turns.isAlreadyRunning('ses_1', 'now ship it'));
  assert.ok(!turns.isAlreadyRunning('ses_2', 'fix the build'), 'another session is another turn');

  turns.clearInFlight('ses_1');
  assert.ok(!turns.isAlreadyRunning('ses_1', 'fix the build'));
});

test('queued prompts drain oldest first, and only for their own key', () => {
  const turns = new TurnRegistry();
  assert.ok(turns.enqueue('ses_1', { taskId: 'TASK-1', prompt: 'first', sessionId: 'ses_1' }));
  assert.ok(turns.enqueue('ses_1', { taskId: 'TASK-1', prompt: 'second', sessionId: 'ses_1' }));
  assert.ok(turns.enqueue('ses_2', { taskId: 'TASK-1', prompt: 'elsewhere', sessionId: 'ses_2' }));

  assert.strictEqual(turns.shift('ses_1')?.prompt, 'first');
  assert.strictEqual(turns.shift('ses_1')?.prompt, 'second');
  assert.strictEqual(turns.shift('ses_1'), undefined);
  assert.strictEqual(turns.shift('ses_2')?.prompt, 'elsewhere');
});

test('the same prompt queued twice is one entry, not two sends', () => {
  const turns = new TurnRegistry();
  assert.ok(turns.enqueue('ses_1', { taskId: 'TASK-1', prompt: 'again', sessionId: 'ses_1' }));
  assert.ok(!turns.enqueue('ses_1', { taskId: 'TASK-1', prompt: 'again', sessionId: 'ses_1' }));

  assert.strictEqual(turns.queuedForTask('TASK-1').length, 1);
});

test('a turn that created its session carries its queue onto it', () => {
  const turns = new TurnRegistry();
  turns.beginStart('new:TASK-1', 'the first prompt');
  turns.enqueue('new:TASK-1', { taskId: 'TASK-1', prompt: 'typed while it was starting' });

  turns.rekey('new:TASK-1', 'ses_new', 'ses_new');

  assert.ok(turns.isAlreadyRunning('ses_new', 'the first prompt'), 'the in-flight prompt moves too');
  assert.strictEqual(turns.shift('new:TASK-1'), undefined, 'nothing is stranded under the old key');
  const carried = turns.shift('ses_new');
  assert.strictEqual(carried?.prompt, 'typed while it was starting');
  assert.strictEqual(carried?.sessionId, 'ses_new');
});

test('rekeying to the same key leaves the queue alone', () => {
  const turns = new TurnRegistry();
  turns.enqueue('ses_1', { taskId: 'TASK-1', prompt: 'waiting', sessionId: 'ses_1' });

  turns.rekey('ses_1', 'ses_1', 'ses_1');

  assert.strictEqual(turns.shift('ses_1')?.prompt, 'waiting');
});

test('stopping a session drops what was waiting on it, and nothing else', () => {
  const turns = new TurnRegistry();
  turns.enqueue('ses_1', { taskId: 'TASK-1', prompt: 'doomed', sessionId: 'ses_1' });
  turns.enqueue('ses_2', { taskId: 'TASK-1', prompt: 'survives', sessionId: 'ses_2' });

  assert.strictEqual(turns.clear('ses_1'), 1);

  assert.strictEqual(turns.shift('ses_1'), undefined);
  assert.strictEqual(turns.shift('ses_2')?.prompt, 'survives');
});

test('deleting a task drops every queue it owns', () => {
  const turns = new TurnRegistry();
  turns.enqueue('ses_1', { taskId: 'TASK-1', prompt: 'a', sessionId: 'ses_1' });
  turns.enqueue('ses_2', { taskId: 'TASK-1', prompt: 'b', sessionId: 'ses_2' });
  turns.enqueue('ses_3', { taskId: 'TASK-2', prompt: 'c', sessionId: 'ses_3' });

  assert.strictEqual(turns.clearTask('TASK-1'), 2);

  assert.strictEqual(turns.queuedForTask('TASK-1').length, 0);
  assert.strictEqual(turns.queuedForTask('TASK-2').length, 1);
});

test('one queued prompt can be taken back by id, but not from another task', () => {
  const turns = new TurnRegistry();
  turns.enqueue('ses_1', { taskId: 'TASK-1', prompt: 'mine', sessionId: 'ses_1' });
  const [queued] = turns.queuedForTask('TASK-1');
  assert.ok(queued);

  assert.strictEqual(turns.remove(queued.id, 'TASK-2'), undefined);
  assert.strictEqual(turns.remove(queued.id, 'TASK-1')?.prompt, 'mine');
  assert.strictEqual(turns.queuedForTask('TASK-1').length, 0);
});

test('a stopped session stays stopped until a new turn starts in it', () => {
  const turns = new TurnRegistry();
  turns.markStopped(['ses_1', 'ses_child']);

  assert.ok(turns.isStopped('ses_1'));
  assert.ok(turns.isStopped('ses_child'));
  assert.ok(!turns.isStopped('ses_other'));
  assert.ok(!turns.isStopped(undefined), 'a turn with no session has nothing to have stopped');

  turns.clearStopped('ses_1');
  assert.ok(!turns.isStopped('ses_1'));
  assert.ok(turns.isStopped('ses_child'), 'clearing one session does not revive the rest');
});

test('an empty session id is not a session that can be stopped', () => {
  const turns = new TurnRegistry();
  turns.markStopped(['', 'ses_1']);

  assert.ok(!turns.isStopped(''));
  assert.ok(turns.isStopped('ses_1'));
});
