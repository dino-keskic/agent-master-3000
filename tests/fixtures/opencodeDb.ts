import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

export const DAY = 24 * 60 * 60 * 1000;
export const NOW = 2_000_000_000_000;

/**
 * An id the way OpenCode makes one: 12 hex digits of `ms * 0x1000 + counter`,
 * then 14 base62 characters. OpenCode orders parts by id, so fixture ids that
 * do not sort by creation time hide ordering bugs rather than catch them.
 */
export function openCodeId(prefix: string, ms: number, counter = 1, tail = 'AAAAAAAAAAAAAA'): string {
  const hex = (BigInt(ms) * 0x1000n + BigInt(counter)).toString(16).padStart(12, '0');
  return `${prefix}_${hex}${tail}`;
}

/**
 * A throwaway OpenCode database on disk, shaped like the real one.
 *
 * Every test file makes its own — node runs each file in its own process, so
 * the module-level read handle in `server/opencode/db.ts` is per file too, and
 * rows one file inserts are invisible to the next.
 */
export function makeFixture(): { file: string; live: string; dead: string; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-oc-'));
  const live = path.join(root, 'web-app');
  const dead = path.join(root, 'web-app.worktrees', 'feature-x');
  fs.mkdirSync(live, { recursive: true });
  // dead worktree is intentionally not created

  const file = path.join(root, 'opencode.db');
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE project (
      id TEXT PRIMARY KEY,
      worktree TEXT NOT NULL,
      vcs TEXT, name TEXT, icon_url TEXT, icon_color TEXT,
      time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL,
      time_initialized INTEGER, sandboxes TEXT NOT NULL
    );
    CREATE TABLE project_directory (
      project_id TEXT NOT NULL, directory TEXT NOT NULL, type TEXT, strategy TEXT,
      time_created INTEGER NOT NULL,
      PRIMARY KEY (project_id, directory)
    );
    CREATE TABLE session (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, parent_id TEXT,
      slug TEXT NOT NULL DEFAULT '', directory TEXT NOT NULL, title TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '',
      summary_additions INTEGER, summary_deletions INTEGER, summary_files INTEGER,
      time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, time_archived INTEGER,
      agent TEXT, model TEXT, cost REAL NOT NULL DEFAULT 0,
      tokens_input INTEGER NOT NULL DEFAULT 0, tokens_output INTEGER NOT NULL DEFAULT 0,
      tokens_reasoning INTEGER NOT NULL DEFAULT 0, tokens_cache_read INTEGER NOT NULL DEFAULT 0,
      tokens_cache_write INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
    );
  `);

  db.prepare(`INSERT INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES (?, ?, 1, 1, '[]')`)
    .run('proj-spa', live);
  db.prepare(`INSERT INTO project_directory (project_id, directory, strategy, time_created) VALUES (?, ?, 'git_worktree', 1)`)
    .run('proj-spa', dead);

  const insert = db.prepare(`
    INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, summary_files, summary_additions, summary_deletions, agent, tokens_input)
    VALUES (?, 'proj-spa', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run('ses-chat-today', null, live, 'Daily Status Sync', 1, NOW, 0, 0, 0, 'Ask Agent', 0);
  insert.run('ses-diff-yesterday', null, live, 'Fix navbar', 1, NOW - DAY, 2, 20, 1, 'Local', 80_000);
  db.prepare(`UPDATE session SET cost = ?, model = ? WHERE id = ?`).run(
    12.4,
    JSON.stringify({ id: 'grok-4.5', providerID: 'github-copilot' }),
    'ses-diff-yesterday'
  );
  const MSG_USER = openCodeId('msg', NOW - 2);
  const MSG_ASSISTANT = openCodeId('msg', NOW);
  const MSG_TAIL = openCodeId('msg', NOW + 3);
  const insertMessage = db.prepare(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`);
  const insertPart = db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`);
  insertMessage.run(
    MSG_USER,
    'ses-diff-yesterday',
    NOW - 2,
    NOW - 2,
    JSON.stringify({ role: 'user' })
  );
  insertMessage.run(
    MSG_ASSISTANT,
    'ses-diff-yesterday',
    NOW,
    NOW,
    JSON.stringify({
      role: 'assistant',
      modelID: 'grok-4.5',
      providerID: 'github-copilot',
      agent: 'Local',
      mode: 'Local',
      variant: 'high',
      tokens: { total: 175339, input: 2143, output: 68, cache: { read: 173056, write: 0 } },
      cost: 0.09
    })
  );
  // OpenCode often writes a trailing 0-token assistant message after the turn.
  insertMessage.run(
    MSG_TAIL,
    'ses-diff-yesterday',
    NOW + 3,
    NOW + 3,
    JSON.stringify({ role: 'assistant', tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } })
  );
  insertPart.run(openCodeId('prt', NOW - 2), MSG_USER, 'ses-diff-yesterday', NOW - 2, NOW - 2, JSON.stringify({ type: 'text', text: 'Please fix the navbar overflow' }));
  insertPart.run(openCodeId('prt', NOW - 1), MSG_ASSISTANT, 'ses-diff-yesterday', NOW - 1, NOW - 1, JSON.stringify({ type: 'reasoning', text: 'Looking at the header flex wrap.' }));
  insertPart.run(openCodeId('prt', NOW), MSG_ASSISTANT, 'ses-diff-yesterday', NOW, NOW, JSON.stringify({
    type: 'tool',
    tool: 'read',
    callID: 'call-1',
    state: { status: 'completed', input: { filePath: '/tmp/Header.tsx' }, output: 'export const Header' }
  }));
  insertPart.run(openCodeId('prt', NOW + 1), MSG_ASSISTANT, 'ses-diff-yesterday', NOW + 1, NOW + 1, JSON.stringify({ type: 'text', text: 'I tightened the flex wrap on the header.' }));
  insertPart.run(openCodeId('prt', NOW + 2), MSG_ASSISTANT, 'ses-diff-yesterday', NOW + 2, NOW + 2, JSON.stringify({ type: 'step-finish', reason: 'end_turn' }));
  insert.run('ses-diff-old-live', null, live, 'Ancient live diff', 1, NOW - 60 * DAY, 8, 400, 10, 'Local', 5_000_000);
  insert.run('ses-diff-old-dead', null, dead, 'Huge PR on deleted worktree', 1, NOW - 14 * DAY, 12, 80, 20, 'Local', 900_000);
  insert.run('ses-subagent', 'ses-diff-yesterday', live, 'Review PR (@coderabbit-code-reviewer subagent)', 1, NOW, 2, 8, 1, 'Ask Agent', 10_000);
  insert.run('ses-sub-subagent', 'ses-subagent', live, 'Nested worker subagent', 1, NOW, 0, 0, 0, 'Ask Agent', 2_000);
  db.prepare(`UPDATE session SET cost = ? WHERE id = ?`).run(3.6, 'ses-subagent');
  db.prepare(`UPDATE session SET cost = ? WHERE id = ?`).run(0.4, 'ses-sub-subagent');
  insert.run('ses-untitled', null, live, 'New session - 2026-01-01', 1, NOW, 0, 0, 0, 'Local', 0);
  insertPart.run(
    'prt-running',
    MSG_ASSISTANT,
    'ses-subagent',
    NOW,
    NOW,
    JSON.stringify({ type: 'tool', tool: 'task', state: { status: 'running' } })
  );

  db.close();
  return { file, live, dead, root };
}
