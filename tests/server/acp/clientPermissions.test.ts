import test from 'node:test';
import assert from 'node:assert';
import { AcpManager } from '../../../server/acp/client.js';
import { BoardTask, PendingPermission, PendingQuestion, PendingRequest } from '../../../shared/types.js';
import { FAKE_AGENT } from '../../fixtures/paths.js';

function task(id: string, overrides: Partial<BoardTask> = {}): BoardTask {
  return {
    id,
    title: 'fake',
    description: 'fake',
    prompt: 'do the thing',
    columnId: 'backlog',
    runState: 'idle',
    model: 'test/model',
    agent: 'Local',
    thinkingLevel: 'default',
    cwd: process.cwd(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    logs: [],
    ...overrides
  };
}

/** Waits for `check` to return a value, or throws after `timeoutMs`. */
async function waitFor<T>(check: () => T | undefined, timeoutMs = 8000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function withFakeAgent(
  script: 'permission' | 'abandoned' | 'elicitation',
  fn: (ctx: {
    manager: AcpManager;
    parked: PendingRequest[];
    agentText: () => string;
  }) => Promise<void>
) {
  process.env.ACP_COMMAND = `node ${FAKE_AGENT}`;
  process.env.ACP_FAKE_SCRIPT = script;

  const manager = new AcpManager();
  const parked: PendingRequest[] = [];
  let agentText = '';

  manager.setEventCallback((_taskId, event) => {
    if (event.type === 'awaiting_input' && event.request) parked.push(event.request);
    if (event.type === 'log' && event.log?.type === 'agent_say') agentText = event.log.text;
  });

  try {
    await fn({ manager, parked, agentText: () => agentText });
  } finally {
    manager.destroy();
    delete process.env.ACP_COMMAND;
    delete process.env.ACP_FAKE_SCRIPT;
  }
}

test('ACP permission and question round trip', async (t) => {
  await t.test('manual mode parks the request and relays the chosen option', async () => {
    await withFakeAgent('permission', async ({ manager, parked, agentText }) => {
      const board = task('TASK-1');
      manager.setPermissionMode(board.id, 'manual');
      await manager.startTaskExecution(board, 'go');

      const request = (await waitFor(() => parked[0])) as PendingPermission;
      assert.strictEqual(request.type, 'permission');
      assert.strictEqual(request.toolCall.name, 'bash');
      assert.strictEqual(request.toolCall.kind, 'execute');
      assert.deepStrictEqual(request.toolCall.locations, ['/tmp/project/build']);
      assert.deepStrictEqual(request.toolCall.rawInput, { command: 'rm -rf build' });
      // Approvals are ordered first so the buttons never reshuffle.
      assert.deepStrictEqual(request.options.map((o) => o.kind), ['allow_once', 'allow_always', 'reject_once']);

      // Still parked until answered.
      assert.strictEqual(manager.pendingRequestFor('TASK-1')?.requestId, request.requestId);

      const delivered = manager.resolvePendingRequest({
        kind: 'permission',
        requestId: request.requestId,
        optionId: 'allow'
      });
      assert.strictEqual(delivered, true);

      // The stub echoes the JSON-RPC result it received.
      const echoed = await waitFor(() => (agentText().includes('ANSWERED permission') ? agentText() : undefined));
      assert.match(echoed, /"outcome":\{"outcome":"selected","optionId":"allow"\}/);
      assert.strictEqual(manager.pendingRequestFor('TASK-1'), undefined);
    });
  });

  await t.test('auto mode answers without ever asking the user', async () => {
    await withFakeAgent('permission', async ({ manager, parked, agentText }) => {
      const board = task('TASK-2');
      manager.setPermissionMode(board.id, 'auto');
      await manager.startTaskExecution(board, 'go');

      const echoed = await waitFor(() => (agentText().includes('ANSWERED permission') ? agentText() : undefined));
      assert.match(echoed, /"optionId":"allow"/);
      assert.strictEqual(parked.length, 0, 'nothing should have been surfaced to the user');
    });
  });

  await t.test('review-writes still stops a shell command', async () => {
    await withFakeAgent('permission', async ({ manager, parked }) => {
      const board = task('TASK-3');
      manager.setPermissionMode(board.id, 'review-writes');
      await manager.startTaskExecution(board, 'go');

      const request = await waitFor(() => parked[0]);
      assert.strictEqual(request.type, 'permission');
    });
  });

  await t.test('a request the last turn abandoned does not hide the next turn\'s', async () => {
    await withFakeAgent('abandoned', async ({ manager, parked }) => {
      const board = task('TASK-5');
      manager.setPermissionMode(board.id, 'manual');
      await manager.startTaskExecution(board, 'go');
      const first = await waitFor(() => parked[0]);

      // The turn ended with the request still parked. Kept, it would sit at the
      // head of the session's queue forever, and every later request — the read
      // outside the working folder — would wait behind it with nothing shown.
      await waitFor(() => (manager.pendingRequestFor(board.id) === undefined ? true : undefined));

      await manager.startTaskExecution(board, 'again');
      const second = await waitFor(() => parked.find((r) => r.requestId !== first.requestId));
      assert.strictEqual(manager.pendingRequestFor(board.id)?.requestId, second.requestId);
    });
  });

  await t.test('cancelling a turn releases the agent instead of leaving it blocked', async () => {
    await withFakeAgent('permission', async ({ manager, parked, agentText }) => {
      const board = task('TASK-4');
      manager.setPermissionMode(board.id, 'manual');
      await manager.startTaskExecution(board, 'go');
      await waitFor(() => parked[0]);

      await manager.cancelTurn(board.id);
      const echoed = await waitFor(() => (agentText().includes('ANSWERED permission') ? agentText() : undefined));
      assert.match(echoed, /"outcome":\{"outcome":"cancelled"\}/);
      assert.strictEqual(manager.pendingRequestFor('TASK-4'), undefined);
    });
  });

  await t.test('an elicitation becomes a typed question form and accepts an answer', async () => {
    await withFakeAgent('elicitation', async ({ manager, parked, agentText }) => {
      const board = task('TASK-5');
      manager.setPermissionMode(board.id, 'auto');
      await manager.startTaskExecution(board, 'go');

      const question = (await waitFor(() => parked[0])) as PendingQuestion;
      assert.strictEqual(question.type, 'question');
      assert.strictEqual(question.message, 'Which environment should I deploy to?');
      assert.strictEqual(question.mode, 'form');

      const byName = Object.fromEntries(question.fields.map((f) => [f.name, f]));
      assert.deepStrictEqual(byName.environment?.options, ['staging', 'production']);
      assert.strictEqual(byName.environment?.required, true);
      assert.strictEqual(byName.notes?.required, false);
      assert.strictEqual(byName.confirm?.type, 'boolean');

      manager.resolvePendingRequest({
        kind: 'question',
        requestId: question.requestId,
        action: 'accept',
        content: { environment: 'staging', confirm: true }
      });

      const echoed = await waitFor(() => (agentText().includes('ANSWERED elicitation') ? agentText() : undefined));
      assert.match(echoed, /"action":"accept"/);
      assert.match(echoed, /"environment":"staging"/);
    });
  });

  await t.test('answering an unknown request is refused rather than silently dropped', async () => {
    await withFakeAgent('permission', async ({ manager }) => {
      const delivered = manager.resolvePendingRequest({
        kind: 'permission',
        requestId: 'does-not-exist',
        optionId: 'allow'
      });
      assert.strictEqual(delivered, false);
    });
  });
});
