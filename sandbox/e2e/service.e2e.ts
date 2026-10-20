import { after, before, describe, it } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BoardTask } from '../../shared/types.js';
import { MODEL, api, boardEnvFor, makeWorkspace, startBoard, transcriptText, waitFor, type Board } from './harness.js';
import { LONG_REPLY_MS, LONG_TRIGGER, REPLY, StubLlm, echoReply, startStubLlm } from './stubLlm.js';

/**
 * The board on OpenCode 2's background service, end to end, in the sandbox.
 *
 * The point of that driver: a turn runs in the service, not in a child of the
 * board, so it keeps going while the board is down, and the board that comes
 * back follows it to the end. This starts a long turn, stops the board in the
 * middle of it, starts a new one, and checks that the task ends idle with the
 * whole reply — and that the service was the one that ran it.
 *
 * Skipped on OpenCode 1.x, which has no service (`OPENCODE_VERSION=2.0.24
 * npm run sandbox:e2e`). Sealed like the ACP e2e; see `harness.ts`.
 */

const version = (() => {
  try {
    return execFileSync('opencode', ['--version'], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
})();
// It prints `opencode v2.0.24` on 2.x, a bare `1.18.32` on 1.x.
const isV2 = /(^|\s)v?2\.\d/.test(version);

describe('board ↔ OpenCode 2 service ↔ stub LLM', { skip: isV2 ? false : `OpenCode ${version || '?'} has no background service` }, () => {
  let root = '';
  let workspace = '';
  let stub: StubLlm;
  let board: Board;
  let boardEnv: NodeJS.ProcessEnv;
  let task: BoardTask;
  let output = '';

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-e2e-svc-'));
    workspace = path.join(root, 'workspace');
    makeWorkspace(workspace);
    stub = await startStubLlm();
    // No ACP_COMMAND: the board picks its driver from the OpenCode it finds.
    boardEnv = boardEnvFor(root, workspace, stub.port);
    board = await startBoard(boardEnv);
  });

  after(async () => {
    await board?.stop();
    // The service is not the board's to stop, and in a real setup it is the
    // user's. Here it is the test's: the run's whole HOME goes with it.
    try {
      execFileSync('opencode', ['service', 'stop'], { env: boardEnv, stdio: 'ignore', timeout: 15_000 });
    } catch { /* already gone */ }
    await stub?.close();
    if (process.env.ACP_E2E_KEEP !== '1' && root) fs.rmSync(root, { recursive: true, force: true });
  });

  function withServerLog(err: unknown): never {
    const tail = `${output}${board?.output() ?? ''}`.split('\n').slice(-120).join('\n');
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${message}\n--- board server output (tail) ---\n${tail}`);
  }

  async function settledTask(what: string, done: (t: BoardTask) => boolean, timeoutMs?: number): Promise<BoardTask> {
    return waitFor(what, async () => {
      const current = await api<BoardTask>(board, 'GET', `/api/tasks/${task.id}`);
      if (current.runState === 'error') throw new Error(`task errored:\n${transcriptText(current.logs)}`);
      return done(current) ? current : undefined;
    }, timeoutMs);
  }

  it('drives OpenCode through its service and runs a turn', async () => {
    try {
      task = await api<BoardTask>(board, 'POST', '/api/tasks', {
        title: 'E2E service',
        prompt: 'Say hello to the e2e test.',
        model: MODEL,
        cwd: workspace,
        permissionMode: 'review-writes'
      });
      await api(board, 'POST', `/api/tasks/${task.id}/run`, {});
      task = await settledTask('the first turn to finish', (t) =>
        t.runState === 'idle' && !!t.sessionId && transcriptText(t.logs).includes(REPLY));
      assert.match(board.output(), /through its background service/, 'the board did not pick the service driver');
      const serviceFile = path.join(boardEnv.XDG_STATE_HOME!, 'opencode', 'service.json');
      assert.ok(fs.existsSync(serviceFile), 'the board did not start OpenCode\'s service');
      assert.ok(!/password/i.test(board.output()), 'the board logged something about the service password');
    } catch (e) { withServerLog(e); }
  });

  it('keeps a turn running across a board restart and follows it to the end', async () => {
    try {
      const reply = echoReply('outlived');
      await api(board, 'POST', `/api/tasks/${task.id}/prompt`, { prompt: `Reply with ${LONG_TRIGGER}outlived` });
      // Started streaming: the turn is in the service, mid-reply.
      await waitFor('the long reply to start', async () => {
        const t = await api<BoardTask>(board, 'GET', `/api/tasks/${task.id}`);
        return t.logs.some((l) => l.type === 'agent_say' && reply.startsWith(l.text.slice(0, 3)) && l.text.length < reply.length) || undefined;
      }, 15_000);
      const stoppedAt = Date.now();

      output += board.output();
      await board.stop();
      board = await startBoard(boardEnv);

      const booted = await api<BoardTask>(board, 'GET', `/api/tasks/${task.id}`);
      assert.ok(Date.now() - stoppedAt < LONG_REPLY_MS, 'the restart took longer than the turn; the test proves nothing');
      assert.notStrictEqual(transcriptText(booted.logs).includes(reply), true, 'the reply was already whole before the restart');

      const done = await settledTask('the outlived turn to finish', (t) =>
        t.runState === 'idle' && transcriptText(t.logs).includes(reply), LONG_REPLY_MS + 30_000);
      assert.match(board.output(), /following the turn OpenCode kept running/, 'the new board did not adopt the turn');
      assert.strictEqual(done.sessionId, task.sessionId);
      // One user turn, answered once: the service did not rerun it.
      const prompts = stub.requests.filter((r) => JSON.stringify(r.messages ?? []).includes(`${LONG_TRIGGER}outlived`) && (r.tools ?? []).length > 0);
      assert.strictEqual(prompts.length, 1, `the long prompt reached the model ${prompts.length} times`);
      task = done;
    } catch (e) { withServerLog(e); }
  });
});
