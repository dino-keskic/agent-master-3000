import test from 'node:test';
import assert from 'node:assert';
import { setTimeout as sleep } from 'timers/promises';
import { AcpTransport } from '../../../server/acp/transport.js';
import { DYING_AGENT, FAKE_AGENT } from '../../fixtures/paths.js';

const handlers = { onRequest: () => {}, onNotification: () => {}, onExit: () => {} };

async function withCommand(command: string, body: () => Promise<void>): Promise<void> {
  const saved = process.env.ACP_COMMAND;
  process.env.ACP_COMMAND = command;
  try {
    await body();
  } finally {
    process.env.ACP_COMMAND = saved;
  }
}

test('an agent that cannot be started fails requests at once, and the next request tries again', async () => {
  let transport: AcpTransport | undefined;
  try {
    await withCommand('/nonexistent/agent-bin acp', async () => {
      transport = new AcpTransport(handlers);
      await sleep(100);
      const started = Date.now();
      await assert.rejects(transport.request('initialize', {}), /could not be started.*ENOENT/);
      assert.ok(Date.now() - started < 1000, 'no waiting out a timeout on a process that is not there');
    });
    // OpenCode turns up; asking again finds it without restarting the board.
    await withCommand(`${process.execPath} ${FAKE_AGENT}`, async () => {
      await transport!.request('initialize', { protocolVersion: 1 });
      assert.ok(transport!.pid());
    });
  } finally {
    transport?.destroy();
  }
});

test('a request right after the agent died starts a new one instead of writing to the dead one', async () => {
  await withCommand(`${process.execPath} ${FAKE_AGENT}`, async () => {
    const transport = new AcpTransport(handlers);
    try {
      await transport.request('initialize', { protocolVersion: 1 });
      const first = transport.pid()!;
      process.kill(first, 'SIGKILL');
      for (let i = 0; i < 50 && transport.pid() === first; i++) await sleep(20);

      const answered = await Promise.race([
        transport.request('initialize', { protocolVersion: 1 }).then(() => true),
        sleep(2000).then(() => false)
      ]);
      assert.ok(answered, 'answered well inside the restart delay');
      assert.notStrictEqual(transport.pid(), first);
    } finally {
      transport.destroy();
    }
  });
});

test('an agent that quits while starting fails requests with what it printed', async () => {
  await withCommand(`${process.execPath} ${DYING_AGENT}`, async () => {
    const transport = new AcpTransport(handlers);
    try {
      await assert.rejects(
        transport.request('session/new', {}),
        (err: Error) => {
          assert.match(err.message, /^OpenCode quit while starting \(code 1\):/);
          assert.match(err.message, /Configuration is invalid at \/cfg\/opencode\.json\n.*got 5 model/);
          assert.ok(!err.message.includes('\u001b'), 'no colour codes');
          return true;
        }
      );
    } finally {
      transport.destroy();
    }
  });
});
