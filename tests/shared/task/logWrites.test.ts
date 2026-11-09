import test from 'node:test';
import assert from 'node:assert';
import { MAX_LOG_TEXT, applyLogToTask, clipLogItem, mergeLogsIntoTask } from '../../../shared/task/logWrites.js';
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

test('an answer is stored whole; a tool output is cut to a glance', () => {
  const long = 'word '.repeat(4_000);
  const said = clipLogItem({ id: 'a', timestamp: 1, type: 'agent_say', title: 'Agent', text: long });
  assert.strictEqual(said.text, long);
  const ran = clipLogItem({ id: 't', timestamp: 1, type: 'tool_call', title: 'bash', text: long });
  assert.strictEqual(ran.text, `${long.slice(0, MAX_LOG_TEXT)}\n…`);
});

test('an answer an older board cut short is restored when it is read again', () => {
  const long = 'word '.repeat(4_000);
  const t = task({ logs: [{ id: 'a', timestamp: 1, type: 'agent_say', title: 'Agent', text: `${long.slice(0, MAX_LOG_TEXT)}\n…` }] });
  mergeLogsIntoTask(t, [{ id: 'a', timestamp: 1, type: 'agent_say', title: 'Agent', text: long }]);
  assert.strictEqual(t.logs[0]?.text, long);
});
