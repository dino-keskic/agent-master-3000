import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import { setTimeout as sleep } from 'timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { ApprovalDesk } from '../../../server/acp/approvals.js';
import { AcpEvent } from '../../../server/acp/events.js';
import { SessionConfigurator } from '../../../server/acp/sessionConfig.js';
import { AcpSessionRegistry } from '../../../server/acp/sessionRegistry.js';
import { SessionLifecycle } from '../../../server/acp/sessions.js';
import { TranscriptStream } from '../../../server/acp/transcript.js';
import { AcpTransport } from '../../../server/acp/transport.js';
import { TurnRunner } from '../../../server/acp/turns.js';
import { closeReadDb } from '../../../server/opencode/db.js';
import { BoardTask } from '../../../shared/types.js';
import { ROOT, V2_NOW, makeV2Fixture } from '../../fixtures/opencodeDbV2.js';

function makeTask(cwd: string, sessionId: string): BoardTask {
  return {
    id: 'TASK-1',
    title: 'Fix image limit bug',
    description: '',
    prompt: 'Continue debugging',
    columnId: 'col-1',
    runState: 'idle',
    model: 'google/gemini-4-hydrogen',
    agent: 'build',
    thinkingLevel: 'default',
    sessionId,
    cwd,
    createdAt: V2_NOW,
    updatedAt: V2_NOW,
    logs: []
  };
}

function seedTwelveImages(dbFile: string, sessionId: string): void {
  const db = new DatabaseSync(dbFile);
  try {
    db.prepare(`
      INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
      VALUES (?, ?, 'user', 25, ?, ?, ?)
    `).run(
      'msg_many_imgs',
      sessionId,
      V2_NOW + 10,
      V2_NOW + 10,
      JSON.stringify({
        text: 'Screenshots attached across turns',
        files: Array.from({ length: 12 }, (_, i) => ({
          name: `shot-${i + 1}.png`,
          mime: 'image/png',
          data: `base64-${i + 1}`
        }))
      })
    );
  } finally {
    db.close();
  }
}

function setupRunner(onPrompt: (sessionId: string, prompt: unknown[]) => unknown) {
  const loaded: string[] = [];
  const prompted: { sessionId: string; prompt: unknown[] }[] = [];
  const events: AcpEvent[] = [];

  const transport = {
    request: (method: string, params: Record<string, unknown>) => {
      if (method === 'session/load') {
        loaded.push(String(params.sessionId));
        return Promise.resolve({ sessionId: params.sessionId, configOptions: [] });
      }
      if (method === 'session/prompt') {
        const sid = String(params.sessionId);
        const blocks = (params.prompt as unknown[]) || [];
        prompted.push({ sessionId: sid, prompt: blocks });
        try {
          return Promise.resolve(onPrompt(sid, blocks));
        } catch (err) {
          return Promise.reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
      return Promise.resolve({});
    },
    notify: () => {},
    respond: () => {}
  } as unknown as AcpTransport;

  const registry = new AcpSessionRegistry();
  const approvals = new ApprovalDesk({
    respond: () => {},
    emit: (_taskId, ev) => events.push(ev),
    folderFor: () => undefined,
    knownToolCall: () => undefined
  });
  const transcript = new TranscriptStream(registry);
  const emit = (_taskId: string, ev: AcpEvent) => events.push(ev);
  const config = new SessionConfigurator(transport, registry, emit, () => {});
  const sessions = new SessionLifecycle(transport, registry, approvals, transcript, config, emit);
  const runner = new TurnRunner(transport, registry, config, sessions, emit);
  return { runner, loaded, prompted, events, registry };
}

test('TurnRunner automatically recovers and retries once when OpenCode reports too many images', async (t) => {
  const { file, dir } = makeV2Fixture();
  closeReadDb();
  process.env.OPENCODE_DB = file;
  t.after(() => {
    closeReadDb();
    fs.rmSync(file.replace(/\/opencode\.db$/, ''), { recursive: true, force: true });
  });
  seedTwelveImages(file, ROOT);

  const { runner, loaded, prompted, events } = setupRunner((sessionId) => {
    if (sessionId === ROOT) {
      throw new Error('Internal error: too many images: maximum allowed for model gemini-4-hydrogen is 10, got 12');
    }
    return { stopReason: 'end_turn' };
  });

  const task = makeTask(dir, ROOT);
  await runner.start(task, 'Please continue');

  for (let i = 0; i < 40 && !events.some((e) => e.log?.title === 'Turn Complete'); i++) {
    await sleep(25);
  }

  const recoveredEvent = events.find((e) => e.type === 'session_recovered');
  assert.ok(recoveredEvent?.sessionId, 'emits session_recovered event');
  assert.strictEqual(recoveredEvent.previousSessionId, ROOT);
  assert.notStrictEqual(recoveredEvent.sessionId, ROOT);
  assert.ok(loaded.includes(recoveredEvent.sessionId), 'loads trimmed recovery session');

  assert.strictEqual(prompted.length, 2, 'retries prompt once in the recovered session');
  assert.strictEqual(prompted[0]!.sessionId, ROOT);
  assert.strictEqual(prompted[1]!.sessionId, recoveredEvent.sessionId);

  assert.ok(!events.some((e) => e.type === 'error'), 'does not emit an error event once recovered');
  assert.ok(events.some((e) => e.log?.title === 'Turn Complete'));

  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db
      .prepare('SELECT data FROM session_message WHERE session_id = ? AND seq = 25')
      .get(recoveredEvent.sessionId) as { data: string };
    const parsed = JSON.parse(row.data);
    assert.strictEqual(parsed.files.length, 5, 'keeps 5 newest images out of 12 (leaving headroom under 10)');
    assert.strictEqual(parsed.files[0].name, 'shot-8.png');
  } finally {
    db.close();
  }
});

test('TurnRunner.compact recovers from too many images by compacting a trimmed copy', async (t) => {
  const { file, dir } = makeV2Fixture();
  closeReadDb();
  process.env.OPENCODE_DB = file;
  t.after(() => {
    closeReadDb();
    fs.rmSync(file.replace(/\/opencode\.db$/, ''), { recursive: true, force: true });
  });
  seedTwelveImages(file, ROOT);

  const { runner, prompted, events } = setupRunner((sessionId) => {
    if (sessionId === ROOT) {
      throw new Error('Internal error: too many images: maximum allowed for model gemini-4-hydrogen is 10, got 12');
    }
    return { stopReason: 'end_turn' };
  });

  await runner.compact(makeTask(dir, ROOT), ROOT);

  const recoveredEvent = events.find((e) => e.type === 'session_recovered');
  assert.ok(recoveredEvent?.sessionId);
  assert.strictEqual(prompted.length, 2);
  assert.strictEqual(prompted[1]!.sessionId, recoveredEvent.sessionId);
  assert.ok(events.some((e) => e.log?.title === 'Session compacted'));
  assert.ok(!events.some((e) => e.type === 'error'));
});
