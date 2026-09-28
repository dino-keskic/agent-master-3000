import test from 'node:test';
import assert from 'node:assert';
import { logsForSession } from '../../../shared/task/logs.js';
import { TaskLogItem, TaskSessionLink } from '../../../shared/types.js';

function log(id: string, timestamp: number, sessionId?: string): TaskLogItem {
  return { id, timestamp, type: 'info', text: id, ...(sessionId ? { sessionId } : {}) };
}

function link(sessionId: string, createdAt: number, kind: TaskSessionLink['kind'] = 'main'): TaskSessionLink {
  return { sessionId, title: sessionId, kind, createdAt };
}

const links = [link('old', 1_000), link('new', 5_000), link('side', 3_000, 'btw')];
const logs = [
  log('created', 500),
  log('old-untagged', 2_000),
  log('old-tagged', 2_500, 'old'),
  log('during-side', 3_500),
  log('new-untagged', 6_000),
  log('new-tagged', 6_500, 'new')
];

test('a new session shows none of the untagged history before it', () => {
  assert.deepStrictEqual(logsForSession(logs, 'new', links).map((l) => l.id), ['new-untagged', 'new-tagged']);
});

test('the first session keeps what came before any session, and what it ran', () => {
  assert.deepStrictEqual(
    logsForSession(logs, 'old', links).map((l) => l.id),
    ['created', 'old-untagged', 'old-tagged', 'during-side']
  );
});

test('a side session sees untagged rows only from its start', () => {
  assert.deepStrictEqual(
    logsForSession(logs, 'side', links).map((l) => l.id),
    ['during-side', 'new-untagged']
  );
});

test('without links, or for a session not linked, the old rule stands', () => {
  assert.strictEqual(logsForSession(logs, 'new').length, 5);
  assert.strictEqual(logsForSession(logs, 'subagent', links).length, 4);
  const untagged = [log('a', 1), log('b', 2)];
  assert.strictEqual(logsForSession(untagged, 'x').length, 2);
});
