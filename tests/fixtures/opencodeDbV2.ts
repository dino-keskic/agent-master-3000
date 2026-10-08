import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { openCodeId } from './opencodeDb.js';

/**
 * A throwaway OpenCode 2 database, as 2.0.24 lays one out — rows copied from
 * what it wrote in the sandbox for a turn that thought, ran a shell command,
 * and handed work to a subagent.
 *
 * It also carries the 1.x tables a migration leaves behind, holding a stale
 * copy of the session under the same id: the readers must never see it.
 */

export const V2_NOW = 2_000_000_000_000;
export const ROOT = 'ses_root';
export const CHILD = 'ses_child';
export const RUNNING = 'ses_running';

export function makeV2Fixture(): { file: string; dir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-oc2-'));
  const dir = path.join(root, 'web-app');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(root, 'opencode.db');
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE project (
      id TEXT PRIMARY KEY, worktree TEXT NOT NULL, vcs TEXT, name TEXT, icon_url TEXT,
      icon_url_override TEXT, icon_color TEXT, time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL, time_initialized INTEGER, time_active INTEGER DEFAULT 0 NOT NULL,
      sandboxes TEXT NOT NULL, commands TEXT
    );
    CREATE TABLE project_directory (
      project_id TEXT NOT NULL, directory TEXT NOT NULL, type TEXT, strategy TEXT,
      time_created INTEGER NOT NULL, PRIMARY KEY (project_id, directory)
    );
    CREATE TABLE event_sequence (aggregate_id TEXT PRIMARY KEY, seq INTEGER NOT NULL, owner_id TEXT);
    CREATE TABLE session_v2 (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, workspace_id TEXT, parent_id TEXT,
      fork_session_id TEXT, fork_boundary TEXT, slug TEXT NOT NULL, directory TEXT NOT NULL,
      path TEXT, title TEXT, version TEXT NOT NULL, share_url TEXT, summary_additions INTEGER,
      summary_deletions INTEGER, summary_files INTEGER, summary_diffs TEXT, metadata TEXT,
      cost REAL DEFAULT 0 NOT NULL, tokens_input INTEGER DEFAULT 0 NOT NULL,
      tokens_output INTEGER DEFAULT 0 NOT NULL, tokens_reasoning INTEGER DEFAULT 0 NOT NULL,
      tokens_cache_read INTEGER DEFAULT 0 NOT NULL, tokens_cache_write INTEGER DEFAULT 0 NOT NULL,
      revert TEXT, permission TEXT, agent TEXT, model TEXT, time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL, time_idle INTEGER, time_viewed INTEGER, idle_outcome TEXT,
      time_compacting INTEGER, time_archived INTEGER, time_suspended INTEGER,
      resume_attempts INTEGER DEFAULT 0 NOT NULL
    );
    CREATE INDEX session_v2_parent_idx ON session_v2 (parent_id);
    CREATE TABLE session_message (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL,
      time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
    );
    CREATE UNIQUE INDEX session_message_session_seq_idx ON session_message (session_id, seq);
    CREATE INDEX session_message_session_type_seq_idx ON session_message (session_id, type, seq);
    CREATE INDEX session_message_session_time_created_id_idx ON session_message (session_id, time_created, id);
    CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL);

    -- Left behind by the migration from 1.x.
    CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, directory TEXT, title TEXT,
      time_created INTEGER, time_updated INTEGER, agent TEXT, model TEXT, cost REAL);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
  `);

  db.prepare(`INSERT INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES ('global', ?, 1, 1, '[]')`).run(dir);
  db.prepare(`INSERT INTO session VALUES (?, 'global', NULL, ?, 'Stale 1.x copy', 1, 1, 'old', 'old/model', 99)`).run(ROOT, dir);
  db.prepare(`INSERT INTO message VALUES ('msg_stale', ?, 1, 1, '{"role":"user"}')`).run(ROOT);
  db.prepare(`INSERT INTO part VALUES ('prt_stale', 'msg_stale', ?, 1, 1, '{"type":"text","text":"stale prompt"}')`).run(ROOT);

  const session = db.prepare(`
    INSERT INTO session_v2 (id, project_id, parent_id, slug, directory, title, version, cost,
      tokens_input, tokens_output, agent, model, time_created, time_updated)
    VALUES (?, 'global', ?, ?, ?, ?, '2.0.24', ?, ?, ?, ?, ?, ?, ?)
  `);
  // 2.x leaves the root's agent and model empty until something switches them.
  session.run(ROOT, null, 'hidden-meadow', dir, 'Fix the build', 0.5, 24, 16, null, null, V2_NOW - 100, V2_NOW);
  session.run(CHILD, ROOT, 'quick-lagoon', dir, 'Child label', 0.25, 12, 8, 'general', null, V2_NOW - 60, V2_NOW - 50);
  session.run(RUNNING, null, 'busy-river', dir, 'Still going', 0, 0, 0, null, null, V2_NOW - 30, V2_NOW - 5);

  const message = db.prepare(
    `INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const id = (ms: number) => openCodeId('msg', ms);
  const model = { id: 'm', providerID: 'stub' };
  const tokens = { input: 12, output: 8, reasoning: 0, cache: { read: 0, write: 0 } };

  message.run(id(V2_NOW - 100), ROOT, 'user', 4, V2_NOW - 100, V2_NOW - 100, JSON.stringify({
    time: { created: V2_NOW - 100 }, text: 'Please fix the build.', files: []
  }));
  message.run(id(V2_NOW - 90), ROOT, 'assistant', 7, V2_NOW - 90, V2_NOW - 40, JSON.stringify({
    time: { created: V2_NOW - 90, streamed: V2_NOW - 85, completed: V2_NOW - 40 },
    agent: 'build',
    model: { ...model, variant: 'high' },
    content: [
      { type: 'reasoning', text: 'Check the compiler first.', state: { reasoningField: 'reasoning_content' }, time: { created: V2_NOW - 88, completed: V2_NOW - 86 } },
      { type: 'tool', id: 'call_1', name: 'shell', executed: false, state: {
        status: 'completed', input: { command: 'npm run build' },
        content: [{ type: 'text', text: 'built\n' }], metadata: { status: 'completed', truncated: false, exit: 0 }
      }, time: { created: V2_NOW - 85, ran: V2_NOW - 84, completed: V2_NOW - 70 } },
      { type: 'tool', id: 'call_2', name: 'subagent', executed: false, state: {
        status: 'completed', input: { agent: 'general', description: 'Child label', prompt: 'child-task' },
        content: [{ type: 'text', text: '<subagent sessionID="ses_child" state="completed">\nDone\n</subagent>' }],
        metadata: { sessionID: CHILD, status: 'completed', truncated: false }
      }, time: { created: V2_NOW - 65, ran: V2_NOW - 64, completed: V2_NOW - 45 } },
      { type: 'tool', id: 'call_3', name: 'execute', executed: false, state: {
        status: 'completed', input: { code: 'return await tools["echo-board"].echo({ text: "hi" });' },
        content: [{ type: 'text', text: 'hi' }],
        metadata: { toolCalls: [{ tool: 'echo-board.echo', status: 'completed', input: { text: 'hi' } }], truncated: false }
      }, time: { created: V2_NOW - 44, ran: V2_NOW - 43, completed: V2_NOW - 42 } }
    ],
    snapshot: { start: 'a', end: 'a', files: [] },
    finish: 'tool-calls', cost: 0.25, tokens
  }));
  message.run(id(V2_NOW - 30), ROOT, 'assistant', 16, V2_NOW - 30, V2_NOW - 20, JSON.stringify({
    time: { created: V2_NOW - 30, completed: V2_NOW - 20 }, agent: 'build', model,
    content: [{ type: 'text', text: 'The build is green.' }], finish: 'stop', cost: 0.25, tokens
  }));
  message.run(id(V2_NOW - 19), ROOT, 'idle', 21, V2_NOW - 19, V2_NOW - 19, JSON.stringify({
    time: { created: V2_NOW - 19 }, outcome: 'succeeded'
  }));

  message.run(id(V2_NOW - 60), CHILD, 'user', 4, V2_NOW - 60, V2_NOW - 60, JSON.stringify({
    time: { created: V2_NOW - 60 }, text: 'child-task'
  }));
  message.run(id(V2_NOW - 55), CHILD, 'assistant', 5, V2_NOW - 55, V2_NOW - 50, JSON.stringify({
    time: { created: V2_NOW - 55, completed: V2_NOW - 50 }, agent: 'general', model,
    content: [{ type: 'text', text: 'Done' }], finish: 'stop', cost: 0.25, tokens
  }));

  message.run(id(V2_NOW - 30) + 'r', RUNNING, 'user', 4, V2_NOW - 30, V2_NOW - 30, JSON.stringify({
    time: { created: V2_NOW - 30 }, text: 'Run the tests'
  }));
  message.run(id(V2_NOW - 25) + 'r', RUNNING, 'assistant', 7, V2_NOW - 25, V2_NOW - 5, JSON.stringify({
    time: { created: V2_NOW - 25 }, agent: 'build', model,
    content: [{ type: 'tool', id: 'call_9', name: 'shell', state: { status: 'running', input: { command: 'npm test' } }, time: { created: V2_NOW - 20 } }]
  }));

  // 2.x's cache of the models.dev catalog: an older fetch, and the current one.
  const catalog = db.prepare(`INSERT INTO kv (key, value, time_created, time_updated) VALUES (?, ?, ?, ?)`);
  const cachedCatalog = (context: number) => JSON.stringify({
    updatedAt: V2_NOW,
    digest: 'd',
    body: JSON.stringify({ stub: { id: 'stub', models: { m: { id: 'm', name: 'M', cost: { input: 1, output: 2 }, limit: { context } } } } }) + '\n'
  });
  catalog.run('models-dev:catalog:old', cachedCatalog(1_000), V2_NOW - 500, V2_NOW - 500);
  catalog.run('models-dev:catalog:new', cachedCatalog(54_321), V2_NOW - 400, V2_NOW - 400);
  catalog.run('unrelated', '{}', V2_NOW, V2_NOW);

  const counter = db.prepare(`INSERT INTO event_sequence (aggregate_id, seq) VALUES (?, ?)`);
  counter.run(ROOT, 21);
  counter.run(CHILD, 12);
  counter.run(RUNNING, 9);
  db.close();
  return { file, dir };
}
