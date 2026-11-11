import test from 'node:test';
import assert from 'node:assert/strict';
import { managerTranscript } from '../../../shared/manager/transcript.js';
import { MANAGER_BRIEFING } from '../../../shared/manager/briefing.js';
import { TaskLogItem } from '../../../shared/types.js';

function log(id: string, type: TaskLogItem['type'], text: string): TaskLogItem {
  return { id, timestamp: 1, type, title: '', text };
}

test('the briefing is left out of the manager transcript', () => {
  const logs = [log('a', 'user_say', MANAGER_BRIEFING), log('b', 'agent_say', 'Two tasks need you.')];
  assert.deepEqual(managerTranscript(logs).map((item) => item.id), ['b']);
});

test('what the user typed stays, and an untouched transcript keeps its identity', () => {
  const logs = [log('a', 'user_say', 'Status update, please'), log('b', 'agent_say', 'All quiet.')];
  assert.equal(managerTranscript(logs), logs);
});
