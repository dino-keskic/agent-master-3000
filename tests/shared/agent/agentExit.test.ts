import test from 'node:test';
import assert from 'node:assert';
import { STDERR_KEEP_CHARS, agentExitMessage, appendStderr, stderrTail } from '../../../shared/agent/agentExit.js';

// What OpenCode 1.18 prints for a config file it will not load.
const CONFIG_ERROR =
  '\u001b[91m\u001b[1mError: \u001b[0mConfiguration is invalid at /home/u/.config/opencode/opencode.json\n' +
  '↳ Expected string | undefined, got 5 model\n';

test('stderrTail', async (t) => {
  await t.test('drops colour codes and blank lines', () => {
    assert.strictEqual(
      stderrTail(`${CONFIG_ERROR}\n\n`),
      'Error: Configuration is invalid at /home/u/.config/opencode/opencode.json\n↳ Expected string | undefined, got 5 model'
    );
  });

  await t.test('keeps only the last lines', () => {
    const noisy = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    const tail = stderrTail(noisy).split('\n');
    assert.strictEqual(tail.length, 12);
    assert.strictEqual(tail.at(-1), 'line 39');
  });

  await t.test('is empty for a process that said nothing', () => {
    assert.strictEqual(stderrTail('\n  \n'), '');
  });
});

test('appendStderr keeps the end of a long stream', () => {
  const full = appendStderr('x'.repeat(STDERR_KEEP_CHARS), 'the reason');
  assert.strictEqual(full.length, STDERR_KEEP_CHARS);
  assert.ok(full.endsWith('the reason'));
});

test('agentExitMessage', async (t) => {
  await t.test('a startup failure carries what OpenCode said', () => {
    const message = agentExitMessage({ code: 1, started: false, stderr: CONFIG_ERROR });
    assert.match(message, /^OpenCode quit while starting \(code 1\):\nError: Configuration is invalid/);
    assert.match(message, /got 5 model$/);
  });

  await t.test('a silent startup failure says how to find out more', () => {
    assert.match(agentExitMessage({ code: 1, started: false, stderr: '' }), /without saying why.*opencode acp/);
  });

  await t.test('a crash mid-work keeps the message requests have always failed with', () => {
    assert.strictEqual(
      agentExitMessage({ code: null, signal: 'SIGKILL', started: true, stderr: '' }),
      'opencode acp process exited (signal SIGKILL) before the request completed'
    );
    assert.match(agentExitMessage({ code: 1, started: true, stderr: 'boom\n' }), /completed:\nboom$/);
  });
});
