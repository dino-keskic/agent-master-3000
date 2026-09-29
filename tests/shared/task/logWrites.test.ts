import test from 'node:test';
import assert from 'node:assert';
import { applyLogToTask, mergeLogsIntoTask } from '../../../shared/task/logWrites.js';
import { TaskLogItem } from '../../../shared/types.js';
import { link, task } from '../../fixtures/boardTasks.js';

/**
 * What writing a transcript line does to the task around it — above all, when
 * it counts as the task having been updated, which is what "Updated today"
 * filters on.
 */

const DAY = 24 * 60 * 60 * 1000;

function say(id: string, timestamp: number, text = id): TaskLogItem {
  return { id, timestamp, type: 'agent_say', text, sessionId: 'ses_1' };
}

test('replaying old history dates the task by the history, not by the read', () => {
  const lastWeek = Date.now() - 7 * DAY;
  const t = task({ updatedAt: lastWeek, sessions: [link({ sessionId: 'ses_1', updatedAt: lastWeek })] });

  const changed = mergeLogsIntoTask(t, [say('a', lastWeek - 1_000), say('b', lastWeek)]);

  assert.strictEqual(changed.length, 2);
  assert.strictEqual(t.updatedAt, lastWeek);
  assert.strictEqual(t.sessions?.[0]?.updatedAt, lastWeek);
});

test('replayed rows older than the task never move updatedAt backwards', () => {
  const t = task({ updatedAt: 50_000 });
  mergeLogsIntoTask(t, [say('old', 10_000)]);
  assert.strictEqual(t.updatedAt, 50_000);
});

test('history that arrived since the last read moves updatedAt to when it happened', () => {
  const t = task({ updatedAt: 50_000 });
  mergeLogsIntoTask(t, [say('new', 90_000)]);
  assert.strictEqual(t.updatedAt, 90_000);
});

test('a replay that changes nothing leaves the task alone', () => {
  const t = task({ updatedAt: 50_000, logs: [say('a', 10_000)] });
  assert.deepStrictEqual(mergeLogsIntoTask(t, [say('a', 10_000)]), []);
  assert.strictEqual(t.updatedAt, 50_000);
});

test('a live line is activity now', () => {
  const t = task({ updatedAt: 1_000 });
  const before = Date.now();
  applyLogToTask(t, say('live', 2_000));
  assert.ok(t.updatedAt >= before);
});
