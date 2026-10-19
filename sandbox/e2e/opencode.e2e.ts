import { after, before, describe, it } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import type { AcpSessionSummary } from '../../shared/sessions/types.js';
import type { BoardTask, PendingPermission, TaskLogItem, WebSocketMessage } from '../../shared/types.js';
import {
  MODEL,
  api,
  boardEnvFor,
  makeWorkspace,
  startBoard,
  transcriptText,
  waitFor,
  writeBoardState,
  writeOpenCodeConfig,
  type Board
} from './harness.js';
import {
  ECHO_TRIGGER,
  REPLY,
  SLOW_TRIGGER,
  StubLlm,
  TOOL_OUTPUT,
  TOOL_REPLY_PREFIX,
  TOOL_TRIGGER,
  echoReply,
  startStubLlm
} from './stubLlm.js';

/**
 * The board against a real `opencode acp`, end to end, inside the sandbox.
 *
 * board server ↔ `opencode acp` ↔ the stub LLM in `stubLlm.ts`, all in one
 * container with no network (`sandbox/compose.e2e.yml`). Everything OpenCode
 * and the board write — HOME, config, database, board state — lives in a fresh
 * temp directory that is thrown away afterwards.
 *
 * It refuses to run anywhere but that container (`harness.ts`). Run it with
 * `npm run sandbox:e2e`. With `ACP_E2E_BUNDLE=1` it drives the built
 * `bin/agent-master-3000.mjs` instead of the source, which is what an installed board
 * runs — `npm run build` first.
 */

describe('board ↔ opencode acp ↔ stub LLM', () => {
  let root = '';
  let workspace = '';
  let stub: StubLlm;
  let board: Board;
  let boardEnv: NodeJS.ProcessEnv;
  let socket: WebSocket;
  const pushes: WebSocketMessage[] = [];
  let task: BoardTask;

  /** What a browser tab does: hold a socket and collect every push. */
  async function connect(): Promise<void> {
    socket = new WebSocket(`${board.url.replace('http', 'ws')}/ws`);
    socket.on('message', (data: WebSocket.RawData) => {
      pushes.push(JSON.parse((data as Buffer).toString()) as WebSocketMessage);
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
  }

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-e2e-'));
    workspace = path.join(root, 'workspace');
    makeWorkspace(workspace);

    stub = await startStubLlm();
    boardEnv = boardEnvFor(root, workspace, stub.port, { ACP_COMMAND: 'opencode acp' });
    board = await startBoard(boardEnv);
    await connect();
  });

  after(async () => {
    socket?.close();
    await board?.stop();
    await stub?.close();
    if (process.env.ACP_E2E_KEEP !== '1' && root) fs.rmSync(root, { recursive: true, force: true });
  });

  /** On a failure, what the board and OpenCode said is the first thing anyone needs. */
  function withServerLog(err: unknown): never {
    const tail = board?.output().split('\n').slice(-80).join('\n');
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${message}\n--- board server output (tail) ---\n${tail}`);
  }

  async function settledTask(what: string, done: (t: BoardTask) => boolean): Promise<BoardTask> {
    return waitFor(what, async () => {
      const current = await api<BoardTask>(board, 'GET', `/api/tasks/${task.id}`);
      if (current.runState === 'error') throw new Error(`task errored:\n${transcriptText(current.logs)}`);
      return done(current) ? current : undefined;
    });
  }

  it('offers the stub model from OpenCode\'s own config options', async () => {
    try {
      const config = await api<{ models: { id: string }[] }>(board, 'GET', '/api/config-options');
      assert.ok(
        config.models.some((m) => m.id === MODEL),
        `expected ${MODEL} among ${config.models.map((m) => m.id).join(', ') || 'no models'}`
      );
      assert.ok(!board.output().includes('Error fetching config options'), 'the board could not read OpenCode\'s config options');
    } catch (e) { withServerLog(e); }
  });

  it('runs a turn and streams the stub\'s reply into the transcript', async () => {
    try {
      task = await api<BoardTask>(board, 'POST', '/api/tasks', {
        title: 'E2E hello',
        prompt: 'Say hello to the e2e test.',
        model: MODEL,
        cwd: workspace,
        permissionMode: 'review-writes'
      });
      await api(board, 'POST', `/api/tasks/${task.id}/run`, {});

      const done = await settledTask('the first turn to finish', (t) =>
        t.runState === 'idle' && !!t.sessionId && transcriptText(t.logs).includes(REPLY));

      // The reply reached the browser as it streamed, not only in the final state.
      const streamed = pushes.filter((p): p is Extract<WebSocketMessage, { type: 'TASK_LOG' }> =>
        p.type === 'TASK_LOG' && p.taskId === task.id && p.log.type === 'agent_say');
      assert.ok(streamed.length > 0, 'no agent_say log was pushed over the websocket');
      assert.ok(streamed.some((p) => REPLY.startsWith(p.log.text.slice(0, 10))), 'the pushed agent text is not the stub\'s');

      const warnings = done.logs.filter((l) => /Could not (apply|switch)|not in OpenCode's list/.test(l.text));
      assert.deepStrictEqual(warnings.map((l) => l.text), [], 'the board could not configure the session');
      assert.ok(stub.requests.length > 0, 'the stub never heard from OpenCode');
      task = done;
    } catch (e) { withServerLog(e); }
  });

  it('parks a tool call on a permission prompt and runs it once allowed', async () => {
    try {
      const turnStart = pushes.length;
      await api(board, 'POST', `/api/tasks/${task.id}/prompt`, { prompt: `Please ${TOOL_TRIGGER} now.` });

      const asked = await waitFor('a permission prompt', () => {
        const push = pushes.slice(turnStart).find((p) => p.type === 'TASK_AWAITING_INPUT' && p.taskId === task.id);
        return push?.type === 'TASK_AWAITING_INPUT' ? push.request : undefined;
      });
      assert.strictEqual(asked.type, 'permission');
      const request: PendingPermission = asked;
      // OpenCode titles a shell call with its description, so the board falls
      // back to the ACP kind for the label.
      assert.strictEqual(request.toolCall.kind, 'execute');
      assert.match(JSON.stringify(request.toolCall.rawInput ?? {}), new RegExp(TOOL_OUTPUT),
        'the permission prompt does not carry the command it is asking about');
      const allow = request.options.find((o) => o.kind === 'allow_once');
      assert.ok(allow, `no allow_once option in ${JSON.stringify(request.options)}`);

      await api(board, 'POST', `/api/tasks/${task.id}/respond`, {
        kind: 'permission',
        requestId: request.requestId,
        optionId: allow.optionId
      });

      const done = await settledTask('the tool turn to finish', (t) =>
        t.runState === 'idle' && transcriptText(t.logs).includes(TOOL_REPLY_PREFIX));
      const text = transcriptText(done.logs);
      assert.match(text, new RegExp(`${TOOL_REPLY_PREFIX} ${TOOL_OUTPUT}`), 'the stub did not see the tool\'s output');
      assert.ok(done.logs.some((l) => l.type === 'tool_call' && l.toolCall?.status === 'completed'),
        'no completed tool call in the transcript');
      task = done;
    } catch (e) { withServerLog(e); }
  });

  it('finds the session, its model and its history in OpenCode\'s database', async () => {
    try {
      const sessionId = task.sessionId;
      assert.ok(sessionId, 'the task has no session id');

      const listed = await waitFor('the session in the OpenCode DB list', async () => {
        const res = await api<{ sessions: AcpSessionSummary[] }>(
          board, 'GET', `/api/acp/sessions?cwd=${encodeURIComponent(workspace)}&untitled=1`);
        return res.sessions.find((s) => s.sessionId === sessionId);
      }, 15_000);
      assert.strictEqual(listed.cwd, workspace);
      assert.strictEqual(listed.model, MODEL);
      assert.ok((listed.tokenCount ?? 0) > 0, `expected token usage on the session row, got ${listed.tokenCount}`);

      const history = await api<{ logs: TaskLogItem[]; model?: string }>(
        board, 'GET', `/api/tasks/${task.id}/sessions/${sessionId}/history`);
      const text = transcriptText(history.logs);
      assert.ok(text.includes(REPLY), 'the DB history is missing the first reply');
      assert.ok(text.includes(TOOL_REPLY_PREFIX), 'the DB history is missing the reply after the tool');
      assert.ok(history.logs.some((l) => l.type === 'tool_call'), 'the DB history is missing the tool call');
      assert.strictEqual(history.model, MODEL);

      // Every DB reader swallows its own errors to keep the board up, so a
      // schema OpenCode changed underneath it shows up only as this warning.
      const dbWarnings = board.output().split('\n').filter((line) => line.includes('[OpenCode DB]'));
      assert.deepStrictEqual(dbWarnings, [], 'the board could not read part of OpenCode\'s database');
    } catch (e) { withServerLog(e); }
  });

  /**
   * A follow-up's reply, as the browser sees it: pushed while it streams, and
   * in the transcript the drawer loads afterwards.
   */
  async function followUp(marker: string): Promise<BoardTask> {
    const turnStart = pushes.length;
    await api(board, 'POST', `/api/tasks/${task.id}/prompt`, { prompt: `Reply with ${ECHO_TRIGGER}${marker}` });
    const reply = echoReply(marker);
    await waitFor(`the reply to "${marker}" to be pushed`, () => pushes.slice(turnStart).some((p) =>
      p.type === 'TASK_LOG' && p.taskId === task.id && p.log.type === 'agent_say' && p.log.text.includes(reply)) || undefined);
    return settledTask(`the "${marker}" turn to finish`, (t) =>
      t.runState === 'idle' && transcriptText(t.logs).includes(reply));
  }

  it('streams a plain follow-up\'s reply to the browser', async () => {
    try {
      task = await followUp('first');
    } catch (e) { withServerLog(e); }
  });

  it('keeps the transcript and streams follow-ups after the board restarts', async () => {
    try {
      socket.close();
      await board.stop();
      board = await startBoard(boardEnv);
      await connect();

      const reloaded = await api<BoardTask>(board, 'GET', `/api/tasks/${task.id}`);
      const before = transcriptText(reloaded.logs);
      for (const expected of [REPLY, TOOL_REPLY_PREFIX, echoReply('first')]) {
        assert.ok(before.includes(expected), `the transcript lost "${expected}" across the restart`);
      }

      // The session is no longer bound in this process: the follow-up has to
      // pick it up again and still reach the browser.
      const done = await followUp('after-restart');
      const after = transcriptText(done.logs);
      assert.ok(after.includes(echoReply('first')), 'the follow-up after the restart dropped the earlier transcript');
      assert.strictEqual(done.sessionId, reloaded.sessionId, 'the follow-up started a new session instead of continuing');

      task = await followUp('second-after-restart');
    } catch (e) { withServerLog(e); }
  });

  it('opening a task mid-turn keeps its transcript and the stream going', async () => {
    try {
      const turnStart = pushes.length;
      const reply = echoReply('slow');
      await api(board, 'POST', `/api/tasks/${task.id}/prompt`, { prompt: `Reply with ${SLOW_TRIGGER}slow` });
      await waitFor('the slow reply to start streaming', () => pushes.slice(turnStart).some((p) =>
        p.type === 'TASK_LOG' && p.taskId === task.id && p.log.type === 'agent_say' && reply.startsWith(p.log.text.slice(0, 3))) || undefined);

      // What a browser refresh does: the board, then the open task.
      await api(board, 'GET', '/api/board');
      const opened = await api<BoardTask>(board, 'GET', `/api/tasks/${task.id}`);
      assert.strictEqual(opened.runState, 'running', 'opening the task mid-turn did not see it running');
      const openedText = transcriptText(opened.logs);
      for (const expected of [REPLY, echoReply('first'), echoReply('second-after-restart')]) {
        assert.ok(openedText.includes(expected), `opening the task mid-turn lost "${expected}"`);
      }

      const afterOpen = pushes.length;
      await waitFor('the rest of the slow reply to be pushed after the task was opened', () => pushes.slice(afterOpen).some((p) =>
        p.type === 'TASK_LOG' && p.taskId === task.id && p.log.type === 'agent_say' && p.log.text.includes(reply)) || undefined);
      const done = await settledTask('the slow turn to finish', (t) =>
        t.runState === 'idle' && transcriptText(t.logs).includes(reply));
      const copies = done.logs.filter((l) => l.type === 'agent_say' && l.text.includes(reply)).length;
      assert.strictEqual(copies, 1, `the slow reply is in the transcript ${copies} times`);
      task = done;
    } catch (e) { withServerLog(e); }
  });

  it('sends a queued prompt now: the running turn is cut off, the rest of the queue follows', async () => {
    try {
      const turnStart = pushes.length;
      const slow = echoReply('interrupted');
      await api(board, 'POST', `/api/tasks/${task.id}/prompt`, { prompt: `Reply with ${SLOW_TRIGGER}interrupted` });
      await waitFor('the slow reply to start streaming', () => pushes.slice(turnStart).some((p) =>
        p.type === 'TASK_LOG' && p.taskId === task.id && p.log.type === 'agent_say' && slow.startsWith(p.log.text.slice(0, 3))) || undefined);

      await api(board, 'POST', `/api/tasks/${task.id}/prompt`, { prompt: `Reply with ${ECHO_TRIGGER}queued-first` });
      const queued = await api<BoardTask>(board, 'POST', `/api/tasks/${task.id}/prompt`, { prompt: `Reply with ${ECHO_TRIGGER}queued-urgent` });
      assert.deepStrictEqual(
        (queued.queued || []).map((turn) => turn.prompt),
        [`Reply with ${ECHO_TRIGGER}queued-first`, `Reply with ${ECHO_TRIGGER}queued-urgent`]
      );
      const urgent = queued.queued!.find((turn) => turn.prompt?.includes('queued-urgent'))!;

      const sent = await api<BoardTask>(board, 'POST', `/api/tasks/${task.id}/queued/${urgent.id}/now`);
      assert.deepStrictEqual((sent.queued || []).map((turn) => turn.prompt), [
        `Reply with ${ECHO_TRIGGER}queued-urgent`,
        `Reply with ${ECHO_TRIGGER}queued-first`
      ], 'the prompt sent now is not at the front of the queue');

      const done = await settledTask('both queued prompts to be answered', (t) =>
        t.runState === 'idle' && !(t.queued || []).length &&
        transcriptText(t.logs).includes(echoReply('queued-first')));
      const replies = done.logs.filter((l) => l.type === 'agent_say').map((l) => l.text);
      const urgentAt = replies.findIndex((text) => text.includes(echoReply('queued-urgent')));
      const firstAt = replies.findIndex((text) => text.includes(echoReply('queued-first')));
      assert.ok(urgentAt >= 0 && urgentAt < firstAt, 'the prompt sent now was not answered first');
      assert.ok(done.logs.some((l) => l.title === 'Turn Interrupted'), 'the transcript does not say the turn was interrupted');
      assert.ok(!replies.some((text) => text.includes(slow)), 'the interrupted turn finished its reply anyway');
      task = done;
    } catch (e) { withServerLog(e); }
  });

  it('a turn cut off by a Ctrl-C is not running after the restart, and a follow-up still streams', async () => {
    try {
      const turnStart = pushes.length;
      const reply = echoReply('cut-off');
      await api(board, 'POST', `/api/tasks/${task.id}/prompt`, { prompt: `Reply with ${SLOW_TRIGGER}cut-off` });
      await waitFor('the doomed reply to start streaming', () => pushes.slice(turnStart).some((p) =>
        p.type === 'TASK_LOG' && p.taskId === task.id && p.log.type === 'agent_say' && reply.startsWith(p.log.text.slice(0, 3))) || undefined);

      // The whole process group, as a terminal delivers it: `opencode acp`
      // dies too, and leaves the turn unfinished in its database.
      socket.close();
      await board.stop('SIGINT');
      board = await startBoard(boardEnv);
      await connect();

      // Long enough for the startup sync and a poll or two to have judged it.
      await new Promise((r) => setTimeout(r, 6000));
      const reloaded = await api<BoardTask>(board, 'GET', `/api/tasks/${task.id}`);
      assert.strictEqual(reloaded.runState, 'idle', 'the dead turn came back as running');

      task = await followUp('after-ctrl-c');
    } catch (e) { withServerLog(e); }
  });
  /** The tools OpenCode offered the model in the last request that offered any. */
  function lastOffered(): string[] {
    const turn = [...stub.requests].reverse().find((r) => (r.tools ?? []).length > 0);
    return (turn?.tools ?? []).map((t) => t.function?.name ?? '');
  }

  it('hands a tool switch to the running agent — live on 2.x, at the next restart on 1.x', async () => {
    try {
      const major = Number(/(\d+)\./.exec(execFileSync('opencode', ['--version'], { env: boardEnv, encoding: 'utf8' }))?.[1]);
      assert.ok(lastOffered().includes('webfetch'), `webfetch was never offered: ${lastOffered().join(', ')}`);

      const switched = await api<{ pendingRestart: boolean }>(board, 'POST', '/api/tools/policy', { name: 'webfetch', enabled: false });
      assert.strictEqual(switched.pendingRestart, major < 2);
      if (major >= 2) {
        // OpenCode 2 watches the board's file, and reloads it a moment later:
        // a turn from then on runs without the tool, in the same process.
        const switchedAt = Date.now();
        let turns = 0;
        await waitFor('a turn without webfetch', async () => {
          task = await followUp(`webfetch-off-${++turns}`);
          if (!lastOffered().includes('webfetch')) return true;
          await new Promise((r) => setTimeout(r, 500));
          return undefined;
        }, 15_000);
        console.log(`[e2e] the switch reached the running agent after ${Date.now() - switchedAt}ms (${turns} turns)`);
        assert.doesNotMatch(board.output(), /restart/i, 'the agent was restarted for the switch');
        const tools = await api<{ tools: { name: string; enabled: boolean; policy?: boolean }[]; pendingRestart: boolean }>(
          board, 'GET', `/api/tasks/${task.id}/tools`);
        assert.strictEqual(tools.pendingRestart, false);
        assert.deepStrictEqual(tools.tools.find((t) => t.name === 'webfetch'), {
          ...tools.tools.find((t) => t.name === 'webfetch'), enabled: false, policy: false
        });

        // The project's config is merged after the board's file and outvotes
        // it; the panel has to say so rather than show a switch that did nothing.
        const projectConfig = path.join(workspace, 'opencode.json');
        fs.writeFileSync(projectConfig, JSON.stringify({ tools: { webfetch: true } }));
        try {
          const outvoted = await api<{ tools: { name: string; enabled: boolean; policyOverridden?: boolean }[] }>(
            board, 'GET', `/api/tasks/${task.id}/tools?refresh=1`);
          const webfetch = outvoted.tools.find((t) => t.name === 'webfetch');
          assert.strictEqual(webfetch?.enabled, true, 'the project config did not turn webfetch back on');
          assert.strictEqual(webfetch?.policyOverridden, true, 'the panel does not say the board was outvoted');
        } finally {
          fs.rmSync(projectConfig);
        }
      }

      const cleared = await api<{ pendingRestart: boolean }>(board, 'POST', '/api/tools/policy', { name: 'webfetch', enabled: null });
      assert.strictEqual(cleared.pendingRestart, false, 'back to the policy the agent started with');
      if (major >= 2) {
        let turns = 0;
        await waitFor('webfetch to come back', async () => {
          task = await followUp(`webfetch-on-${++turns}`);
          if (lastOffered().includes('webfetch')) return true;
          await new Promise((r) => setTimeout(r, 500));
          return undefined;
        }, 15_000);
      }
    } catch (e) { withServerLog(e); }
  });

  it('offers a provider one project adds, marked with that project, without a restart by hand', async () => {
    try {
      // A second project with no config of its own: the new model is not offered there.
      const other = path.join(root, 'other');
      makeWorkspace(other);
      const { settings } = await api<{ settings: { projects: unknown[] } }>(board, 'GET', '/api/board');
      await api(board, 'POST', '/api/settings', {
        projects: [...settings.projects, { id: 'proj-other', name: 'other', path: other, createdAt: Date.now() }]
      });

      // 1.x reads config once per process, and the board has to notice and restart it.
      fs.writeFileSync(path.join(workspace, 'opencode.json'), JSON.stringify({
        provider: {
          'project-stub': {
            npm: '@ai-sdk/openai-compatible',
            name: 'Project stub',
            options: { baseURL: `http://127.0.0.1:${stub.port}/v1`, apiKey: 'e2e' },
            models: { 'local-model': { name: 'Project local model', limit: { context: 32000, output: 2048 } } }
          }
        }
      }));

      const local = await waitFor('the project\'s model to be offered', async () => {
        const config = await api<{ models: { id: string; onlyIn?: string[]; scope?: string }[] }>(board, 'GET', '/api/config-options');
        return config.models.find((m) => m.id === 'project-stub/local-model');
      }, 30_000);
      assert.deepStrictEqual(local.onlyIn, [workspace]);
      assert.strictEqual(local.scope, 'only in web-app');
      // 1.x reads config once per process, so only a restart offers it; 2.x
      // watches the project's file and has it before the board looks.
      const major = Number(/(\d+)\./.exec(execFileSync('opencode', ['--version'], { env: boardEnv, encoding: 'utf8' }))?.[1]);
      if (major < 2) assert.match(board.output(), /OpenCode config changed since the agent started/);

      const config = await api<{ models: { id: string; onlyIn?: string[] }[] }>(board, 'GET', '/api/config-options');
      assert.ok(config.models.some((m) => m.id === MODEL && !m.onlyIn), 'the global model is still offered everywhere');
    } catch (e) { withServerLog(e); }
  });
});

/**
 * A shell that sets `OPENCODE_CONFIG_DIR` for some other tool: 1.x loads that
 * folder on top of `~/.config/opencode`, 2.x in place of it — and with it the
 * user's own agents and the built-ins they turned off would be gone. The board
 * keeps 1.x's meaning on both (`shared/setup/configOverlay.ts`).
 */
describe('an extra OPENCODE_CONFIG_DIR on top of the global config', () => {
  let root: string;
  let stub: StubLlm;
  let board: Board;

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-e2e-extra-'));
    const workspace = path.join(root, 'workspace');
    makeWorkspace(workspace);
    stub = await startStubLlm();
    const home = path.join(root, 'home');
    const global = path.join(home, '.config', 'opencode');
    writeOpenCodeConfig(global, stub.port);
    const config = JSON.parse(fs.readFileSync(path.join(global, 'opencode.json'), 'utf8'));
    config.agent = { build: { disable: true }, plan: { disable: true } };
    fs.writeFileSync(path.join(global, 'opencode.json'), JSON.stringify(config));
    const agent = (dir: string, name: string) => {
      fs.mkdirSync(path.join(dir, 'agents'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'agents', `${name}.md`), `---\ndescription: ${name}\nmode: primary\n---\nYou are ${name}.\n`);
    };
    agent(global, 'ceo');
    const extra = path.join(root, 'other-tool', 'opencode');
    agent(extra, 'extra-one');
    fs.writeFileSync(path.join(extra, 'opencode.json'), JSON.stringify({ share: 'disabled' }));
    const dbFile = path.join(root, 'opencode', 'opencode.db');
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    const stateFile = path.join(root, 'board_state.json');
    writeBoardState(stateFile, workspace);
    board = await startBoard({
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, '.config'),
      XDG_DATA_HOME: path.join(home, '.local', 'share'),
      XDG_CACHE_HOME: path.join(home, '.cache'),
      XDG_STATE_HOME: path.join(home, '.local', 'state'),
      OPENCODE_CONFIG_DIR: extra,
      OPENCODE_DB: dbFile,
      OPENCODE_DISABLE_AUTOUPDATE: '1',
      OPENCODE_DISABLE_MODELS_FETCH: '1',
      OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
      OPENCODE_DISABLE_SHARE: '1',
      ACP_COMMAND: 'opencode acp',
      BOARD_STATE_FILE: stateFile,
      BOARD_ATTACHMENTS_DIR: path.join(root, 'attachments')
    });
  });

  after(async () => {
    await board?.stop();
    await stub?.close();
    if (process.env.ACP_E2E_KEEP !== '1' && root) fs.rmSync(root, { recursive: true, force: true });
  });

  it('offers the global folder\'s agents and the extra one\'s, and not the built-ins the global one disables', async () => {
    try {
      const config = await api<{ models: { id: string }[]; agents: { name: string }[] }>(
        board, 'GET', `/api/config-options?model=${encodeURIComponent(MODEL)}`);
      const names = config.agents.map((a) => a.name.toLowerCase());
      assert.ok(config.models.some((m) => m.id === MODEL), `the global folder's model is missing: ${config.models.map((m) => m.id).join(', ')}`);
      assert.ok(names.includes('ceo'), `the global folder's agent is missing: ${names.join(', ')}`);
      assert.ok(names.includes('extra-one'), `the extra folder's agent is missing: ${names.join(', ')}`);
      assert.ok(!names.includes('build') && !names.includes('plan'), `disabled built-ins are offered: ${names.join(', ')}`);
    } catch (e) {
      const tail = board?.output().split('\n').slice(-80).join('\n');
      throw new Error(`${e instanceof Error ? e.message : String(e)}\n--- board server output (tail) ---\n${tail}`);
    }
  });
});
