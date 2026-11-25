import test from 'node:test';
import assert from 'node:assert';
import {
  buildForkAnchor,
  forkableMessageId,
  isNoiseLog,
  sliceMessagesForFork,
  sliceV2MessagesForFork
} from '../../../shared/transcript/forkPoint.js';
import { TaskLogItem } from '../../../shared/types.js';

function makeLog(overrides: Partial<TaskLogItem>): TaskLogItem {
  return {
    id: 'log_1',
    timestamp: 1000,
    type: 'agent_say',
    text: 'Done.',
    ...overrides
  };
}

test('isNoiseLog filters routine turn-ended chatter while keeping real notices', () => {
  assert.strictEqual(isNoiseLog(makeLog({ type: 'info', text: 'Agent finished this turn.' })), true);
  assert.strictEqual(isNoiseLog(makeLog({ type: 'info', text: 'Compacted session context.' })), false);
  assert.strictEqual(isNoiseLog(makeLog({ type: 'agent_say', text: 'Agent finished this turn.' })), false);
});

test('forkableMessageId reads explicit messageId or extracts V2 part prefix', () => {
  assert.strictEqual(forkableMessageId({ id: 'prt_1', messageId: 'msg_1' }), 'msg_1');
  assert.strictEqual(forkableMessageId({ id: 'msg_abc:text' }), 'msg_abc');
  assert.strictEqual(forkableMessageId({ id: 'msg_abc:00003' }), 'msg_abc');
  assert.strictEqual(forkableMessageId({ id: 'local-uuid-123' }), undefined);
});

test('buildForkAnchor numbers conversation turns and carries user text on before-mode', () => {
  const logs: TaskLogItem[] = [
    makeLog({ id: 'p1', messageId: 'msg_1', type: 'user_say', text: 'First question' }),
    makeLog({ id: 'p2', messageId: 'msg_2', type: 'tool_call', text: 'read' }),
    makeLog({ id: 'p3', messageId: 'msg_2', type: 'agent_say', text: 'First answer' }),
    makeLog({ id: 'p4', messageId: 'msg_3', type: 'user_say', text: 'Second question' })
  ];

  const onAgent = buildForkAnchor(logs[2]!, logs, 'after');
  assert.deepStrictEqual(onAgent, {
    messageId: 'msg_2',
    logId: 'p3',
    turnNumber: 2,
    role: 'agent',
    mode: 'after',
    label: 'turn #2',
    preview: 'First answer',
    originalText: undefined
  });

  const onUser = buildForkAnchor(logs[3]!, logs, 'before');
  assert.deepStrictEqual(onUser, {
    messageId: 'msg_3',
    logId: 'p4',
    turnNumber: 3,
    role: 'user',
    mode: 'before',
    label: 'turn #3',
    preview: 'Second question',
    originalText: 'Second question'
  });

  assert.strictEqual(buildForkAnchor(logs[1]!, logs, 'after'), undefined);
});

test('sliceMessagesForFork slices V1 rows inclusively or exclusively and rejects missing ids', () => {
  const rows = [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }];
  assert.deepStrictEqual(sliceMessagesForFork(rows, 'm2', false), [{ id: 'm1' }, { id: 'm2' }]);
  assert.deepStrictEqual(sliceMessagesForFork(rows, 'm2', true), [{ id: 'm1' }]);
  assert.deepStrictEqual(sliceMessagesForFork(rows, 'm1', true), []);
  assert.strictEqual(sliceMessagesForFork(rows, 'missing'), null);
});

test('sliceV2MessagesForFork preserves earlier bookkeeping rows and reports new sequence watermark', () => {
  const rows = [
    { id: 'sys', seq: 1 },
    { id: 'm1', seq: 2 },
    { id: 'sw', seq: 3 },
    { id: 'm2', seq: 4 },
    { id: 'm3', seq: 5 }
  ];
  assert.deepStrictEqual(sliceV2MessagesForFork(rows, 'm2', false), {
    items: [
      { id: 'sys', seq: 1 },
      { id: 'm1', seq: 2 },
      { id: 'sw', seq: 3 },
      { id: 'm2', seq: 4 }
    ],
    lastSeq: 4
  });
  assert.deepStrictEqual(sliceV2MessagesForFork(rows, 'm2', true), {
    items: [
      { id: 'sys', seq: 1 },
      { id: 'm1', seq: 2 },
      { id: 'sw', seq: 3 }
    ],
    lastSeq: 3
  });
  assert.strictEqual(sliceV2MessagesForFork(rows, 'missing'), null);
});
