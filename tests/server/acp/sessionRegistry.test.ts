import test from 'node:test';
import assert from 'node:assert';
import { AcpSessionRegistry } from '../../../server/acp/sessionRegistry.js';

test('AcpSessionRegistry', async (t) => {
  await t.test('binds sessions to tasks, and lists them per task', () => {
    const registry = new AcpSessionRegistry();
    registry.bind('ses-main', 'TASK-1');
    registry.bind('ses-fork', 'TASK-1');
    registry.bind('ses-other', 'TASK-2');

    assert.strictEqual(registry.taskOf('ses-fork'), 'TASK-1');
    assert.deepStrictEqual(registry.sessionsOfTask('TASK-1').sort(), ['ses-fork', 'ses-main']);
    assert.deepStrictEqual(registry.sessionsOfTask('TASK-3'), []);

    registry.unbind('ses-fork');
    assert.strictEqual(registry.taskOf('ses-fork'), undefined);
    assert.deepStrictEqual(registry.sessionsOfTask('TASK-1'), ['ses-main']);
  });

  await t.test('a task has one primary session, separate from its bindings', () => {
    const registry = new AcpSessionRegistry();
    registry.bind('ses-fork', 'TASK-1');
    assert.strictEqual(registry.primaryOf('TASK-1'), undefined);

    registry.setPrimary('TASK-1', 'ses-main');
    assert.strictEqual(registry.primaryOf('TASK-1'), 'ses-main');
    registry.clearPrimary('TASK-1');
    assert.strictEqual(registry.primaryOf('TASK-1'), undefined);
    // Releasing the primary must not unbind the task's other sessions.
    assert.strictEqual(registry.taskOf('ses-fork'), 'TASK-1');
  });

  await t.test('distinguishes "never loaded" from "loaded with no options"', () => {
    const registry = new AcpSessionRegistry();
    assert.strictEqual(registry.isLoaded('ses-1'), false);
    assert.strictEqual(registry.configOptions('ses-1'), undefined);

    registry.setConfigOptions('ses-1', []);
    assert.strictEqual(registry.isLoaded('ses-1'), true);
    assert.deepStrictEqual(registry.configOptions('ses-1'), []);
  });

  await t.test('tracks in-flight turns per session', () => {
    const registry = new AcpSessionRegistry();
    assert.strictEqual(registry.inFlightCount(), 0);

    registry.markInFlight('ses-a');
    registry.markInFlight('ses-b');
    assert.strictEqual(registry.isInFlight('ses-a'), true);
    assert.strictEqual(registry.inFlightCount(), 2);
    assert.deepStrictEqual(registry.inFlightSessions().sort(), ['ses-a', 'ses-b']);

    registry.clearInFlight('ses-a');
    assert.strictEqual(registry.isInFlight('ses-a'), false);
    assert.deepStrictEqual(registry.inFlightSessions(), ['ses-b']);
    // Clearing a session nobody ever started is not an error.
    registry.clearInFlight('ses-unknown');
  });

  await t.test('generations mark a turn stale as soon as another claims the session', () => {
    const registry = new AcpSessionRegistry();
    const first = registry.nextGeneration('ses-1');
    assert.strictEqual(registry.isCurrentGeneration('ses-1', first), true);

    const second = registry.nextGeneration('ses-1');
    assert.notStrictEqual(first, second);
    assert.strictEqual(registry.isCurrentGeneration('ses-1', first), false);
    assert.strictEqual(registry.isCurrentGeneration('ses-1', second), true);
    // Generations are per session: a fork's turn does not stale the main one.
    assert.strictEqual(registry.isCurrentGeneration('ses-2', registry.nextGeneration('ses-2')), true);
    assert.strictEqual(registry.isCurrentGeneration('ses-1', second), true);
  });

  await t.test('cancellation is sticky until the next turn clears it', () => {
    const registry = new AcpSessionRegistry();
    assert.strictEqual(registry.isCancelled('ses-1'), false);
    registry.markCancelled('ses-1');
    assert.strictEqual(registry.isCancelled('ses-1'), true);
    registry.clearCancelled('ses-1');
    assert.strictEqual(registry.isCancelled('ses-1'), false);
  });

  await t.test('import suppresses replayed logs only when asked', () => {
    const registry = new AcpSessionRegistry();
    registry.beginImport('TASK-1', 'ses-1', true);
    assert.strictEqual(registry.isImporting('TASK-1'), true);
    assert.strictEqual(registry.replaysSuppressed('ses-1'), false);
    registry.endImport('TASK-1', 'ses-1');
    assert.strictEqual(registry.isImporting('TASK-1'), false);

    registry.beginImport('TASK-2', 'ses-2', false);
    assert.strictEqual(registry.replaysSuppressed('ses-2'), true);
    assert.strictEqual(registry.anyReplaySuppressed(), true);
    registry.endImport('TASK-2', 'ses-2');
    assert.strictEqual(registry.replaysSuppressed('ses-2'), false);
    assert.strictEqual(registry.anyReplaySuppressed(), false);
  });

  await t.test('a quiet reload of one session does not silence the task\'s other sessions', () => {
    const registry = new AcpSessionRegistry();
    registry.beginImport('TASK-1', 'ses-main', false);
    assert.strictEqual(registry.replaysSuppressed('ses-main'), true);
    assert.strictEqual(registry.replaysSuppressed('ses-fork'), false, 'a fork streaming meanwhile is live');
  });

  await t.test('overlapping loads in one task keep it importing until the last ends', () => {
    const registry = new AcpSessionRegistry();
    registry.beginImport('TASK-1', 'ses-a', true);
    registry.beginImport('TASK-1', 'ses-b', true);
    registry.endImport('TASK-1', 'ses-a');
    assert.strictEqual(registry.isImporting('TASK-1'), true);
    registry.endImport('TASK-1', 'ses-b');
    assert.strictEqual(registry.isImporting('TASK-1'), false);
  });

  await t.test('forgetTask clears replay suppression but keeps the bindings a close still needs', () => {
    const registry = new AcpSessionRegistry();
    registry.bind('ses-1', 'TASK-1');
    registry.setPrimary('TASK-1', 'ses-1');
    registry.beginImport('TASK-1', 'ses-1', false);

    registry.forgetTask('TASK-1');
    assert.strictEqual(registry.replaysSuppressed('ses-1'), false);
    // closeSession reads both of these *after* calling forgetTask.
    assert.strictEqual(registry.primaryOf('TASK-1'), 'ses-1');
    assert.deepStrictEqual(registry.sessionsOfTask('TASK-1'), ['ses-1']);
  });

  await t.test('forgetSession keeps what a late reply judges itself by', () => {
    const registry = new AcpSessionRegistry();
    registry.bind('ses-1', 'TASK-1');
    registry.setConfigOptions('ses-1', [{ id: 'model', currentValue: 'gpt' }]);
    registry.setAttribution('ses-1', { model: 'gpt' });
    registry.markInFlight('ses-1');
    registry.markCancelled('ses-1');
    const generation = registry.nextGeneration('ses-1');

    registry.forgetSession('ses-1');
    assert.strictEqual(registry.taskOf('ses-1'), undefined);
    assert.strictEqual(registry.isLoaded('ses-1'), false);
    assert.strictEqual(registry.attribution('ses-1'), undefined);
    assert.strictEqual(registry.isInFlight('ses-1'), false);
    // The pending promise is about to reject and must still see itself as stale-free
    // and cancelled, or it would report a spurious error over the stop.
    assert.strictEqual(registry.isCurrentGeneration('ses-1', generation), true);
    assert.strictEqual(registry.isCancelled('ses-1'), true);
  });

  await t.test('resetBindings drops every binding when the agent process dies', () => {
    const registry = new AcpSessionRegistry();
    registry.bind('ses-1', 'TASK-1');
    registry.bind('ses-2', 'TASK-2');
    registry.setPrimary('TASK-1', 'ses-1');
    registry.markInFlight('ses-2');

    registry.resetBindings();
    assert.deepStrictEqual(registry.boundSessions(), []);
    assert.strictEqual(registry.primaryOf('TASK-1'), undefined);
    assert.deepStrictEqual(registry.inFlightSessions(), []);
  });
});
