import test from 'node:test';
import assert from 'node:assert';
import { spawn, ChildProcess } from 'child_process';
import { commandCore, commandMatches, isShellCommand, killAgentProcesses, listProcesses } from '../../../server/acp/agentProcesses.js';

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function waitFor(check: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (check()) return resolve();
      if (Date.now() > deadline) return reject(new Error('timed out'));
      setTimeout(tick, 25);
    };
    tick();
  });
}

test('command matching is conservative for short commands', () => {
  assert.strictEqual(isShellCommand('/bin/zsh -c npm test'), true);
  assert.strictEqual(isShellCommand('uv tool uvx code-review-graph serve'), false);
  assert.strictEqual(commandCore('zsh -c sleep 30 # marker'), 'sleep 30');
  assert.strictEqual(commandMatches('zsh -c npm test', 'npm test', false), true);
  assert.strictEqual(commandMatches('sleep 30', 'sleep 30 # leftover', false), true);
  assert.strictEqual(commandMatches('sleep 30', 'ls', false), false);
  assert.strictEqual(commandMatches('/bin/ls -la', 'ls', true), true);
});

test('killAgentProcesses reaps descendant shells and leaves outsiders alone', async () => {
  if (process.platform === 'win32') return;

  const marker = `agent-master-3000-kill-test-${Date.now()}`;
  const childCommand = `sleep 30 # ${marker}`;
  const parent = spawn(process.execPath, [
    '-e',
    `
      const { spawn } = require('child_process');
      const child = spawn('sh', ['-c', ${JSON.stringify(childCommand)}], { stdio: 'ignore' });
      child.unref();
      console.log('child=' + child.pid);
      setInterval(() => {}, 1000);
    `
  ], { stdio: ['ignore', 'pipe', 'inherit'] });

  const outsider = spawn('sleep', ['30'], { stdio: 'ignore' });

  let childPid = 0;
  try {
    childPid = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('parent never reported child pid')), 4_000);
      parent.stdout?.on('data', (chunk: Buffer) => {
        const match = /child=(\d+)/.exec(chunk.toString());
        if (match) {
          clearTimeout(timer);
          resolve(Number(match[1]));
        }
      });
      parent.on('error', reject);
    });

    assert.ok(parent.pid && parent.pid > 0);
    await waitFor(() => alive(childPid));
    assert.ok(outsider.pid && alive(outsider.pid));

    const killed = await killAgentProcesses(parent.pid, {
      commands: [childCommand],
      cwds: []
    });
    assert.ok(killed >= 1, `expected to kill the descendant sleep, got ${killed}`);
    await waitFor(() => !alive(childPid));
    assert.ok(outsider.pid && alive(outsider.pid), 'a process that is not under the agent must survive');
  } finally {
    stop(parent);
    stop(outsider);
  }
});

test('listProcesses can see the current test runner', async () => {
  const rows = await listProcesses();
  assert.ok(rows.some((row) => row.pid === process.pid));
});

function stop(child: ChildProcess): void {
  if (!child.pid) return;
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
}
