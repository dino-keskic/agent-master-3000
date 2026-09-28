import test from 'node:test';
import assert from 'node:assert';
import {
  MAX_TASK_LOGS,
  appendLog,
  appendTaskLog,
  combineLogItems,
  failLiveTools,
  mergeSessionTranscript,
  mergeTaskSnapshot,
  sessionTranscript
} from '../../../shared/task/logs.js';
import { BoardTask, TaskLogItem } from '../../../shared/types.js';

function log(overrides: Partial<TaskLogItem> & { id: string }): TaskLogItem {
  return {
    timestamp: 1_000,
    type: 'agent_say',
    text: '',
    ...overrides
  };
}

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

/** A stripped snapshot: what every list response and every push carries. */
function stripped(overrides: Partial<BoardTask> = {}): BoardTask {
  return task({ logs: [], logsOmitted: true, ...overrides });
}

test('appendLog', async (t) => {
  await t.test('appends an unseen entry', () => {
    const next = appendLog([log({ id: 'a', text: 'one' })], log({ id: 'b', text: 'two' }));
    assert.deepStrictEqual(next.map((l) => l.id), ['a', 'b']);
  });

  await t.test('replaces a known id in place rather than appending', () => {
    const logs = [
      log({ id: 'call-1', type: 'tool_call', text: 'read' }),
      log({ id: 'after', text: 'still last' })
    ];
    const next = appendLog(logs, log({ id: 'call-1', type: 'tool_call', text: 'read done', timestamp: 2_000 }));
    assert.deepStrictEqual(next.map((l) => l.id), ['call-1', 'after']);
    assert.strictEqual(next[0]!.text, 'read done');
    assert.strictEqual(next[0]!.timestamp, 2_000);
  });

  await t.test('keeps fields the update does not carry', () => {
    const logs = [log({ id: 'call-1', type: 'tool_call', text: 'bash', toolCall: { toolCallId: 'call-1', name: 'bash', status: 'pending' } })];
    const next = appendLog(logs, { id: 'call-1', timestamp: 2_000, type: 'tool_call', text: 'bash' });
    assert.strictEqual(next[0]!.toolCall?.name, 'bash');
  });

  await t.test('does not leave the original list mutated', () => {
    const logs = [log({ id: 'a' })];
    appendLog(logs, log({ id: 'b' }));
    appendLog(logs, log({ id: 'a', text: 'changed' }));
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0]!.text, '');
  });

  await t.test('caps the transcript at the same length the store keeps', () => {
    let logs: TaskLogItem[] = [];
    for (let i = 0; i < MAX_TASK_LOGS + 40; i++) {
      logs = appendLog(logs, log({ id: `log-${i}`, text: `chunk ${i}` }));
    }
    assert.strictEqual(logs.length, MAX_TASK_LOGS);
    assert.strictEqual(logs[logs.length - 1]!.text, `chunk ${MAX_TASK_LOGS + 39}`);
    assert.ok(!logs.some((l) => l.id === 'log-0'), 'the oldest entries are dropped');
  });

  await t.test('a replacement does not push anything past the cap', () => {
    const logs = Array.from({ length: 3 }, (_, i) => log({ id: `log-${i}` }));
    const next = appendLog(logs, log({ id: 'log-0', text: 'updated' }), 3);
    assert.strictEqual(next.length, 3);
    assert.strictEqual(next[0]!.text, 'updated');
  });
});

test('mergeTaskSnapshot', async (t) => {
  await t.test('takes a snapshot whole when nothing is held yet', () => {
    const incoming = stripped();
    assert.strictEqual(mergeTaskSnapshot(undefined, incoming), incoming);
  });

  await t.test('keeps the transcript a stripped snapshot omits', () => {
    const previous = task({ logs: [log({ id: 'a', text: 'hello' })] });
    const merged = mergeTaskSnapshot(previous, stripped({ runState: 'running' }));
    assert.deepStrictEqual(merged.logs.map((l) => l.id), ['a']);
    assert.strictEqual(merged.runState, 'running', 'everything but the logs comes from the snapshot');
    assert.ok(!merged.logsOmitted, 'the merged task holds a real transcript');
  });

  await t.test('stays marked as omitted until a real transcript arrives', () => {
    const merged = mergeTaskSnapshot(stripped(), stripped({ runState: 'running' }));
    assert.strictEqual(merged.logsOmitted, true);
  });

  await t.test('takes the full task over what streamed in, and keeps what it never saw', () => {
    const previous = stripped({ logs: [log({ id: 'delta', text: 'streamed while fetching' })] });
    const full = task({ logs: [log({ id: 'a' }), log({ id: 'b' })] });
    const merged = mergeTaskSnapshot(previous, full);
    assert.deepStrictEqual(merged.logs.map((l) => l.id), ['a', 'b', 'delta']);
    assert.ok(!merged.logsOmitted);
  });

  await t.test('does not duplicate a delta the full task already carries', () => {
    const previous = stripped({ logs: [log({ id: 'b', text: 'stale' })] });
    const full = task({ logs: [log({ id: 'a' }), log({ id: 'b', text: 'fresh' })] });
    const merged = mergeTaskSnapshot(previous, full);
    assert.deepStrictEqual(merged.logs.map((l) => l.id), ['a', 'b']);
    assert.strictEqual(merged.logs[1]!.text, 'fresh');
  });

  await t.test('caps the union of both transcripts', () => {
    const previous = task({ logs: Array.from({ length: 200 }, (_, i) => log({ id: `old-${i}` })) });
    const full = task({ logs: Array.from({ length: 200 }, (_, i) => log({ id: `new-${i}` })) });
    const merged = mergeTaskSnapshot(previous, full);
    assert.strictEqual(merged.logs.length, MAX_TASK_LOGS);
  });

  await t.test('restores per-session transcripts the same way', () => {
    const previous = task({
      sessions: [{ sessionId: 'ses-1', title: 'Main', kind: 'main', createdAt: 1, logs: [log({ id: 'a' })] }]
    });
    const merged = mergeTaskSnapshot(
      previous,
      stripped({ sessions: [{ sessionId: 'ses-1', title: 'Main', kind: 'main', createdAt: 1, logsOmitted: true }] })
    );
    assert.deepStrictEqual(merged.sessions?.[0]?.logs?.map((l) => l.id), ['a']);
    assert.ok(!merged.sessions?.[0]?.logsOmitted);
  });

  await t.test('leaves a session the client has never seen alone', () => {
    const merged = mergeTaskSnapshot(
      task(),
      stripped({ sessions: [{ sessionId: 'ses-new', title: 'Fork', kind: 'btw', createdAt: 1, logsOmitted: true }] })
    );
    assert.strictEqual(merged.sessions?.[0]?.logsOmitted, true);
  });
});

test('appendTaskLog folds a streamed delta onto a stripped snapshot', () => {
  const previous = task({ logs: [log({ id: 'a' })] });
  const merged = mergeTaskSnapshot(previous, stripped({ runState: 'running' }));
  const withDelta = appendTaskLog(merged, log({ id: 'b', text: 'new chunk' }));
  assert.deepStrictEqual(withDelta.logs.map((l) => l.id), ['a', 'b']);
  assert.strictEqual(withDelta.runState, 'running');
});

test('mergeSessionTranscript', async (t) => {
  await t.test('does not duplicate a streamed turn that OpenCode stored under a different id', () => {
    const live = [
      log({ id: 'uuid-user', type: 'user_say', text: 'Fix the overflow', timestamp: 10, sessionId: 'ses-1' }),
      log({ id: 'uuid-agent', text: 'I tightened the flex wrap on the header.', timestamp: 20, sessionId: 'ses-1' })
    ];
    const history = [
      log({ id: 'prt-user', type: 'user_say', text: 'Fix the overflow', timestamp: 9, sessionId: 'ses-1' }),
      log({
        id: 'prt-agent',
        text: 'I tightened the flex wrap on the header.',
        timestamp: 19,
        sessionId: 'ses-1',
        metadata: { model: 'anthropic/claude', agent: 'build' }
      })
    ];
    const merged = mergeSessionTranscript(live, history);
    assert.deepStrictEqual(merged.map((entry) => entry.id), ['uuid-user', 'uuid-agent']);
    assert.strictEqual(merged[1]!.metadata?.model, 'anthropic/claude');
  });

  await t.test('keeps older history the live cap never streamed', () => {
    const live = [log({ id: 'uuid-now', text: 'Done.', timestamp: 50, sessionId: 'ses-1' })];
    const history = [
      log({ id: 'prt-old', type: 'user_say', text: 'Please start', timestamp: 1, sessionId: 'ses-1' }),
      log({ id: 'prt-now', text: 'Done.', timestamp: 49, sessionId: 'ses-1' })
    ];
    const merged = mergeSessionTranscript(live, history);
    assert.deepStrictEqual(merged.map((entry) => entry.id), ['prt-old', 'uuid-now']);
  });

  await t.test('history-first and live-first produce the same texts in the same order', () => {
    const live = [
      log({ id: 'uuid-1', type: 'user_say', text: 'Hello there, please fix the navbar overflow on mobile', timestamp: 10 }),
      log({ id: 'uuid-2', text: 'Patched the week hole in the header flex wrap.', timestamp: 20 })
    ];
    const history = [
      log({ id: 'prt-1', type: 'user_say', text: 'Hello there, please fix the navbar overflow on mobile', timestamp: 8 }),
      log({ id: 'prt-2', text: 'Patched the week hole in the header flex wrap.', timestamp: 18 })
    ];
    const fromLive = mergeSessionTranscript(live, history).map((entry) => `${entry.type}:${entry.text}`);
    const fromHistory = mergeSessionTranscript([], history);
    const thenLive = mergeSessionTranscript(live, fromHistory).map((entry) => `${entry.type}:${entry.text}`);
    assert.deepStrictEqual(fromLive, thenLive);
  });

  await t.test('matches a still-streaming agent message to the completed history row', () => {
    const live = [log({ id: 'uuid-a', text: 'I tightened the flex wrap on the header', timestamp: 20 })];
    const history = [
      log({ id: 'prt-a', text: 'I tightened the flex wrap on the header by shrinking the actions.', timestamp: 19 })
    ];
    const merged = mergeSessionTranscript(live, history);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0]!.id, 'uuid-a');
    assert.ok(merged[0]!.text.includes('shrinking'));
  });

  await t.test('matches tool calls by toolCallId even when the log id differs', () => {
    const live = [
      log({
        id: 'acp-call',
        type: 'tool_call',
        text: '',
        timestamp: 12,
        toolCall: { toolCallId: 'call-9', name: 'bash', status: 'in_progress' }
      })
    ];
    const history = [
      log({
        id: 'prt-tool',
        type: 'tool_call',
        text: 'done',
        timestamp: 11,
        toolCall: { toolCallId: 'call-9', name: 'bash', status: 'completed', output: 'done' }
      })
    ];
    const merged = mergeSessionTranscript(live, history);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0]!.id, 'acp-call');
    assert.strictEqual(merged[0]!.toolCall?.status, 'completed');
  });
});

test('sessionTranscript keeps one session and still merges history into it', () => {
  const logs = [
    log({ id: 'uuid-main', text: 'Main reply that is long enough to match history', timestamp: 20, sessionId: 'ses-main' }),
    log({ id: 'uuid-fork', text: 'Fork reply', timestamp: 21, sessionId: 'ses-fork' })
  ];
  const history = [
    log({
      id: 'prt-main',
      text: 'Main reply that is long enough to match history',
      timestamp: 19,
      metadata: { model: 'anthropic/claude' }
    })
  ];
  const main = sessionTranscript(logs, 'ses-main', history);
  assert.deepStrictEqual(main.map((entry) => entry.id), ['uuid-main']);
  assert.strictEqual(main[0]!.metadata?.model, 'anthropic/claude');
  assert.deepStrictEqual(sessionTranscript(logs, 'ses-fork').map((entry) => entry.id), ['uuid-fork']);
});

test('combineLogItems keeps the live id so later deltas still replace in place', () => {
  const held = log({ id: 'uuid-a', text: 'Hello from the agent streaming', timestamp: 10 });
  const incoming = log({
    id: 'prt-a',
    text: 'Hello from the agent streaming a longer answer.',
    timestamp: 9,
    metadata: { model: 'anthropic/claude' }
  });
  const combined = combineLogItems(held, incoming);
  assert.strictEqual(combined.id, 'uuid-a');
  assert.strictEqual(combined.timestamp, 10);
  assert.ok(combined.text.includes('longer answer'));
  assert.strictEqual(combined.metadata?.model, 'anthropic/claude');
});

test('appendLog does not append a history copy of a streamed message', () => {
  const logs = [log({ id: 'uuid-a', text: 'Patched the week hole in the header flex wrap.', timestamp: 20 })];
  const next = appendLog(
    logs,
    log({ id: 'prt-a', text: 'Patched the week hole in the header flex wrap.', timestamp: 19 })
  );
  assert.strictEqual(next.length, 1);
  assert.strictEqual(next[0]!.id, 'uuid-a');
});

test('mergeTaskSnapshot does not keep a streamed duplicate the snapshot already has under another id', () => {
  const previous = task({
    logs: [log({ id: 'uuid-a', text: 'I tightened the flex wrap on the header.', timestamp: 20 })]
  });
  const full = task({
    logs: [log({ id: 'prt-a', text: 'I tightened the flex wrap on the header.', timestamp: 19 })]
  });
  const merged = mergeTaskSnapshot(previous, full);
  assert.strictEqual(merged.logs.length, 1);
  assert.strictEqual(merged.logs[0]!.id, 'uuid-a');
});

test('failLiveTools marks in-flight tools failed and leaves other sessions alone', () => {
  const logs = [
    log({
      id: 'bash-main',
      type: 'tool_call',
      sessionId: 'ses-main',
      toolCall: { toolCallId: 'bash-main', name: 'bash', status: 'in_progress' }
    }),
    log({
      id: 'bash-fork',
      type: 'tool_call',
      sessionId: 'ses-fork',
      toolCall: { toolCallId: 'bash-fork', name: 'bash', status: 'pending' }
    }),
    log({
      id: 'bash-done',
      type: 'tool_call',
      sessionId: 'ses-main',
      toolCall: { toolCallId: 'bash-done', name: 'bash', status: 'completed', output: 'ok' }
    })
  ];
  const scoped = failLiveTools(logs, ['ses-main'], 'Stopped');
  assert.strictEqual(scoped.changed.length, 1);
  assert.strictEqual(scoped.logs[0]!.toolCall?.status, 'failed');
  assert.strictEqual(scoped.logs[1]!.toolCall?.status, 'pending');
  assert.strictEqual(scoped.logs[2]!.toolCall?.status, 'completed');

  const all = failLiveTools(logs, undefined, 'Stopped');
  assert.strictEqual(all.changed.length, 2);
  assert.strictEqual(all.logs[1]!.toolCall?.status, 'failed');
});
