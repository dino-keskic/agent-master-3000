import test, { after } from 'node:test';
import assert from 'node:assert';
import { MAX_TASK_LOGS } from '../../../server/board/taskStore.js';
import { freshStore } from '../../fixtures/taskStore.js';

/** The transcript: streaming in place, folding in history, and the previews. */

const { store, cleanup } = freshStore('logs');
after(cleanup);

test('a streamed message is rewritten in place, not appended twice', () => {
  const newTask = store.createTask({ title: 'Streaming Test Task', prompt: 'Test live log streaming' });

  const initialLogCount = newTask.logs.length; // 1 (Task Created info log)
  const messageId = 'msg-chunk-100';

  store.addLogToTask(newTask.id, {
    id: messageId,
    timestamp: 1000,
    type: 'agent_say',
    title: 'OpenCode Agent',
    text: 'Hello '
  });

  let updated = store.getTask(newTask.id);
  assert.strictEqual(updated?.logs.length, initialLogCount + 1);
  assert.strictEqual(updated.logs[initialLogCount]!.text, 'Hello ');

  store.addLogToTask(newTask.id, {
    id: messageId,
    timestamp: 1001,
    type: 'agent_say',
    title: 'OpenCode Agent',
    text: 'Hello world! I am fixing the code.'
  });

  updated = store.getTask(newTask.id);
  assert.strictEqual(updated?.logs.length, initialLogCount + 1, 'the same id updates the item it already wrote');
  assert.strictEqual(updated.logs[initialLogCount]!.text, 'Hello world! I am fixing the code.');
  assert.ok(updated?.lastMessage?.includes('Hello world'));
});

test('user_say updates lastUserMessage', () => {
  const task = store.createTask({ title: 'Follow-up', prompt: 'Original prompt for the agent' });
  assert.ok(task.lastUserMessage?.includes('Original prompt'));

  store.addLogToTask(task.id, {
    id: 'user-1',
    timestamp: Date.now(),
    type: 'user_say',
    text: 'Also fix the overflow on mobile'
  });
  assert.strictEqual(store.getTask(task.id)?.lastUserMessage, 'Also fix the overflow on mobile');
});

test('mergeLogs folds OpenCode history and reports what changed', () => {
  const task = store.createTask({ title: 'Imported', prompt: 'p' });
  store.addLogToTask(task.id, {
    id: 'prt-1',
    timestamp: 10,
    type: 'tool_call',
    text: '',
    toolCall: { toolCallId: 'prt-1', name: 'bash', status: 'in_progress' },
    sessionId: 'ses_x'
  });
  const result = store.mergeLogs(task.id, [
    {
      id: 'prt-1',
      timestamp: 20,
      type: 'tool_call',
      text: 'done',
      toolCall: { toolCallId: 'prt-1', name: 'bash', status: 'completed', output: 'done' },
      sessionId: 'ses_x'
    },
    {
      id: 'prt-2',
      timestamp: 30,
      type: 'agent_say',
      text: 'Patched the week hole.',
      sessionId: 'ses_x'
    }
  ]);
  assert.ok(result);
  assert.strictEqual(result.changed.length, 2);
  assert.strictEqual(result.task.logs.find((l) => l.id === 'prt-1')?.toolCall?.status, 'completed');
  assert.strictEqual(result.task.lastMessage, 'Patched the week hole.');
  const again = store.mergeLogs(task.id, result.task.logs.filter((l) => l.id === 'prt-2'));
  assert.strictEqual(again?.changed.length, 0);
});

test('mergeLogs does not duplicate a streamed turn OpenCode stored under a part id', () => {
  const task = store.createTask({ title: 'Live', prompt: 'p' });
  store.addLogToTask(task.id, {
    id: 'uuid-agent',
    timestamp: 20,
    type: 'agent_say',
    text: 'I tightened the flex wrap on the header.',
    sessionId: 'ses_x'
  });
  const result = store.mergeLogs(task.id, [
    {
      id: 'prt-agent',
      timestamp: 19,
      type: 'agent_say',
      text: 'I tightened the flex wrap on the header.',
      sessionId: 'ses_x',
      metadata: { model: 'anthropic/claude' }
    }
  ]);
  assert.ok(result);
  assert.strictEqual(result.task.logs.filter((l) => l.type === 'agent_say').length, 1);
  assert.strictEqual(result.task.logs[0]!.id, 'uuid-agent');
  assert.strictEqual(result.task.logs[0]!.metadata?.model, 'anthropic/claude');
});

test('persisted logs are capped, keeping the newest', () => {
  const task = store.createTask({ title: 'Chatty', prompt: 'p' });
  for (let i = 0; i < MAX_TASK_LOGS + 40; i++) {
    store.addLogToTask(task.id, { id: `log-${i}`, timestamp: i, type: 'agent_say', text: `chunk ${i}` });
  }
  const updated = store.getTask(task.id);
  assert.ok((updated?.logs.length || 0) <= MAX_TASK_LOGS);
  assert.ok(updated?.logs.some((l) => l.text === `chunk ${MAX_TASK_LOGS + 39}`));
});

test('a log stamped with a session updates that session preview', () => {
  const task = store.createTask({ title: 'Log Link Task', prompt: 'p' });
  store.addLinkedSession(task.id, { sessionId: 'ses_side_1', title: 'Side', kind: 'btw', createdAt: 10 });

  store.addLogToTask(task.id, {
    id: 'log-u1',
    timestamp: 100,
    type: 'user_say',
    title: 'Side Prompt',
    text: 'What is the answer?',
    sessionId: 'ses_side_1'
  });

  store.addLogToTask(task.id, {
    id: 'log-a1',
    timestamp: 101,
    type: 'agent_say',
    title: 'OpenCode',
    text: 'The answer is 42.',
    sessionId: 'ses_side_1'
  });

  const sideSession = store.getTask(task.id)?.sessions?.find((s) => s.sessionId === 'ses_side_1');
  assert.strictEqual(sideSession?.lastUserMessage, 'What is the answer?');
  assert.strictEqual(sideSession?.lastMessage, 'The answer is 42.');
});
