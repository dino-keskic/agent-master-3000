import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import { hydrateTasks, overlayLiveStatus } from '../../../server/opencode/hydrate.js';
import { getOpenCodeSession } from '../../../server/opencode/sessionList.js';
import { AcpSessionSummary } from '../../../shared/sessions/types.js';
import { BoardTask } from '../../../shared/types.js';
import { NOW, makeFixture } from '../../fixtures/opencodeDb.js';

test('OpenCode task hydration', async (t) => {
  const { file, live, root } = makeFixture();
  process.env.OPENCODE_DB = file;

  await t.test('overlayLiveStatus tags worktree dirtiness and last user/agent lines', () => {
    const task: BoardTask = {
      id: 'TASK-1',
      title: 'Fix navbar',
      description: 'p',
      prompt: 'Please fix the navbar overflow',
      columnId: 'deliver',
      runState: 'idle',
      model: 'x',
      agent: 'Local',
      thinkingLevel: 'default',
      cwd: `${live}.worktrees/feature-x`,
      logs: [
        { id: '1', timestamp: 1, type: 'user_say', text: 'Please fix the navbar overflow' },
        { id: '2', timestamp: 2, type: 'agent_say', text: 'I tightened the flex wrap on the header.' }
      ],
      createdAt: 1,
      updatedAt: 1
    };
    const liveTask = overlayLiveStatus(
      task,
      { exists: true, dirty: true, dirtyFiles: ['lib/foo.dart'] },
      { sessionId: 'ses', title: 'Fix navbar', cwd: task.cwd, updatedAt: new Date(NOW).toISOString(), tokenCount: 12_000 },
      [{ name: 'web-app', path: live }]
    );
    assert.strictEqual(liveTask.cwdDirty, true);
    assert.strictEqual(liveTask.worktreeLabel, 'feature-x');
    assert.strictEqual(liveTask.projectName, 'web-app');
    assert.strictEqual(liveTask.tokenCount, 12_000);
    assert.ok(liveTask.lastUserMessage?.includes('navbar'));
    assert.ok(liveTask.lastMessage?.includes('flex wrap'));

    const main = overlayLiveStatus(
      { ...task, cwd: live },
      { exists: true, dirty: true, dirtyFiles: ['README.md'] }
    );
    assert.strictEqual(main.cwdDirty, false, 'main-repo dirtiness is not a per-task signal');
    assert.strictEqual(main.cwdExists, true);

    const gone = overlayLiveStatus(task, { exists: false, dirty: false, dirtyFiles: [] });
    assert.strictEqual(gone.cwdExists, false);
    assert.strictEqual(gone.cwdDirty, false);
  });

  await t.test('overlayLiveStatus copies context onto each linked session', () => {
    const task: BoardTask = {
      id: 'TASK-155',
      title: 'Investigate',
      description: '',
      prompt: 'p',
      columnId: 'execute',
      runState: 'idle',
      model: 'github-copilot/grok-4.6',
      agent: 'build',
      thinkingLevel: 'default',
      sessionId: 'ses_main',
      cwd: '/repo',
      logs: [],
      createdAt: 1,
      updatedAt: 1,
      contextTokens: 1,
      contextLimit: 200000,
      sessions: [
        {
          sessionId: 'ses_main',
          title: 'Main',
          kind: 'main',
          origin: 'initial',
          createdAt: 1
        },
        {
          sessionId: 'ses_fork',
          title: 'Fork',
          kind: 'btw',
          origin: 'fork',
          createdAt: 2
        }
      ]
    };
    const mainLive: AcpSessionSummary = {
      sessionId: 'ses_main',
      title: 'Main',
      cwd: '/repo',
      updatedAt: new Date(NOW).toISOString(),
      cost: 10,
      contextTokens: 206648,
      contextLimit: 500000
    };
    const forkLive: AcpSessionSummary = {
      sessionId: 'ses_fork',
      title: 'Fork',
      cwd: '/repo',
      updatedAt: new Date(NOW).toISOString(),
      cost: 6,
      contextTokens: 152224,
      contextLimit: 200000
    };
    const live = overlayLiveStatus(
      task,
      undefined,
      mainLive,
      [],
      new Map([
        ['ses_main', mainLive],
        ['ses_fork', forkLive]
      ])
    );
    const main = live.sessions?.find((s) => s.sessionId === 'ses_main');
    const fork = live.sessions?.find((s) => s.sessionId === 'ses_fork');
    assert.strictEqual(main?.contextTokens, 206648);
    assert.strictEqual(main?.contextLimit, 500000);
    assert.strictEqual(fork?.contextTokens, 152224);
    assert.strictEqual(fork?.contextLimit, 200000);
    assert.notStrictEqual(main?.contextTokens, fork?.contextTokens);
  });

  await t.test('hydrateTasks pulls token counts from the OpenCode session', async () => {
    const dummy: BoardTask = {
      id: 'TASK-2',
      title: 'Fix navbar',
      description: 'p',
      prompt: 'p',
      columnId: 'backlog',
      runState: 'idle',
      model: 'x',
      agent: 'Local',
      thinkingLevel: 'default',
      sessionId: 'ses-diff-yesterday',
      cwd: live,
      logs: [],
      createdAt: 1,
      updatedAt: 1
    };
    const [hydrated] = await hydrateTasks([dummy]);
    assert.strictEqual(hydrated!.tokenCount, 92_000);
    assert.strictEqual(hydrated!.cost, 16.4);
    assert.strictEqual(hydrated!.subagentCount, 2);
    assert.strictEqual(hydrated!.contextTokens, 175339, 'walks back past the 0-token trailing assistant message');
    assert.strictEqual(hydrated!.cwdExists, true);
    assert.strictEqual(getOpenCodeSession('ses-diff-yesterday')?.tokenCount, 92_000);
    assert.strictEqual(getOpenCodeSession('ses-diff-yesterday')?.cost, 16.4);
    assert.strictEqual(getOpenCodeSession('ses-diff-yesterday')?.subagentCount, 2);
  });

  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.OPENCODE_DB;
});
