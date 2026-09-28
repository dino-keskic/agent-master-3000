import test from 'node:test';
import assert from 'node:assert';
import { AcpManager } from '../../../server/acp/client.js';
import { AcpEvent } from '../../../server/acp/events.js';
import { BoardTask } from '../../../shared/types.js';
import { FAKE_AGENT } from '../../fixtures/paths.js';

/**
 * Turns against the fake agent: what a start sends, and what it does not.
 * The "permission" script answers every prompt with a permission request, so
 * a turn that reached the agent always leaves one parked.
 */

function task(id: string): BoardTask {
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
    logs: []
  };
}

async function withFakeAgent(fn: (manager: AcpManager, events: AcpEvent[]) => Promise<void>) {
  process.env.ACP_COMMAND = `node ${FAKE_AGENT}`;
  process.env.ACP_FAKE_SCRIPT = 'permission';
  const manager = new AcpManager();
  const events: AcpEvent[] = [];
  manager.setEventCallback((_taskId, event) => events.push(event));
  try {
    await fn(manager, events);
  } finally {
    manager.destroy();
    delete process.env.ACP_COMMAND;
    delete process.env.ACP_FAKE_SCRIPT;
  }
}

const settle = () => new Promise((r) => setTimeout(r, 300));

test('an open-only start opens a session and sends nothing', async () => {
  await withFakeAgent(async (manager, events) => {
    const sessionId = await manager.startTaskExecution(task('TASK-1'), undefined, {
      newSession: true,
      primary: true,
      openOnly: true
    });
    await settle();

    assert.strictEqual(sessionId, 'ses_fake_1');
    assert.ok(events.some((e) => e.type === 'session_bound'));
    // Neither the task's prompt nor "Continue." went to the agent.
    assert.ok(!events.some((e) => e.type === 'log' && e.log?.type === 'user_say'));
    assert.ok(!events.some((e) => e.type === 'awaiting_input'));
  });
});

test('a new session without openOnly still runs the task prompt', async () => {
  await withFakeAgent(async (manager, events) => {
    await manager.startTaskExecution(task('TASK-2'), undefined, { newSession: true, primary: true });
    await settle();

    const echo = events.find((e) => e.type === 'log' && e.log?.type === 'user_say');
    assert.strictEqual(echo?.type === 'log' ? echo.log?.text : undefined, 'do the thing');
  });
});
