import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';
import { activeRootSessionIds, activeSessionIds } from '../../../server/opencode/liveTurns.js';
import { DAY, NOW, makeFixture } from '../../fixtures/opencodeDb.js';

test('OpenCode live turn detection', async (t) => {
  const { file, live, root } = makeFixture();
  process.env.OPENCODE_DB = file;

  await t.test('an in-progress tool that started minutes ago still counts as running', () => {
    const db = new DatabaseSync(file);
    db.prepare(`
      INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, summary_files, summary_additions, summary_deletions, agent, tokens_input)
      VALUES (?, 'proj-spa', NULL, ?, 'Long bash', 1, ?, 0, 0, 0, 'Local', 1)
    `).run('ses-long-bash', live, NOW);
    db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        'prt-old-bash',
        'msg-long',
        'ses-long-bash',
        NOW - 10 * 60_000,
        NOW - 10 * 60_000,
        JSON.stringify({ type: 'tool', tool: 'bash', state: { status: 'in_progress' } })
      );
    db.close();
    const liveNow = activeRootSessionIds(['ses-long-bash', 'ses-done'], NOW);
    assert.ok(liveNow.has('ses-long-bash'), 'a long-running tool is still running');
  });

  await t.test('a leftover running bash after the assistant turn completed is not live', () => {
    const db = new DatabaseSync(file);
    db.prepare(`
      INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, summary_files, summary_additions, summary_deletions, agent, tokens_input)
      VALUES (?, 'proj-spa', NULL, ?, 'Cancelled bash', 1, ?, 0, 0, 0, 'Local', 1)
    `).run('ses-cancelled-bash', live, NOW);
    db.prepare(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`)
      .run(
        'msg-cancelled-asst',
        'ses-cancelled-bash',
        NOW - 5_000,
        NOW - 1_000,
        JSON.stringify({ role: 'assistant', error: { name: 'MessageAbortedError' }, time: { created: NOW - 5_000, completed: NOW - 1_000 } })
      );
    db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        'prt-cancelled-bash',
        'msg-cancelled-asst',
        'ses-cancelled-bash',
        NOW - 4_000,
        NOW - 500,
        JSON.stringify({ type: 'tool', tool: 'bash', state: { status: 'running' } })
      );
    db.close();
    const liveNow = activeRootSessionIds(['ses-cancelled-bash'], NOW);
    assert.ok(!liveNow.has('ses-cancelled-bash'), 'Stop left a running part; the completed assistant turn still wins');
  });

  await t.test('a days-old leftover in_progress part is crash debris, not a live turn', () => {
    const db = new DatabaseSync(file);
    db.prepare(`
      INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, summary_files, summary_additions, summary_deletions, agent, tokens_input)
      VALUES (?, 'proj-spa', NULL, ?, 'Stale bash', 1, ?, 0, 0, 0, 'Local', 1)
    `).run('ses-stale-bash', live, NOW - 4 * DAY);
    db.prepare(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`)
      .run(
        'msg-stale-asst',
        'ses-stale-bash',
        NOW - 4 * DAY,
        NOW - 4 * DAY,
        JSON.stringify({ role: 'assistant', finish: 'stop', time: { created: NOW - 4 * DAY, completed: NOW - 4 * DAY } })
      );
    db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        'prt-stale-bash',
        'msg-stale-asst',
        'ses-stale-bash',
        NOW - 4 * DAY,
        NOW - 4 * DAY,
        JSON.stringify({ type: 'tool', tool: 'bash', state: { status: 'in_progress' } })
      );
    db.close();
    const liveNow = activeRootSessionIds(['ses-stale-bash'], NOW);
    assert.ok(!liveNow.has('ses-stale-bash'), 'abandoned in_progress tools do not keep the card running');
  });

  await t.test('an uncompleted assistant message is a live turn even with no tool', () => {
    const db = new DatabaseSync(file);
    db.prepare(`
      INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, summary_files, summary_additions, summary_deletions, agent, tokens_input)
      VALUES (?, 'proj-spa', NULL, ?, 'Thinking', 1, ?, 0, 0, 0, 'Local', 1)
    `).run('ses-thinking', live, NOW - 30_000);
    db.prepare(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`)
      .run(
        'msg-thinking-asst',
        'ses-thinking',
        NOW - 30_000,
        NOW - 5_000,
        JSON.stringify({ role: 'assistant', finish: null, time: { created: NOW - 30_000 }, tokens: { total: 12 } })
      );
    db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        'prt-thinking-reason',
        'msg-thinking-asst',
        'ses-thinking',
        NOW - 5_000,
        NOW - 5_000,
        JSON.stringify({ type: 'reasoning', text: 'looking at the tests' })
      );
    db.close();
    const liveNow = activeRootSessionIds(['ses-thinking'], NOW);
    assert.ok(liveNow.has('ses-thinking'), 'thinking with no tool still counts as running');
  });

  await t.test('a turn that died with the process stops counting as live once it goes quiet', () => {
    const db = new DatabaseSync(file);
    db.prepare(`
      INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, summary_files, summary_additions, summary_deletions, agent, tokens_input)
      VALUES (?, 'proj-spa', NULL, ?, 'Killed mid-turn', 1, ?, 0, 0, 0, 'Local', 1)
    `).run('ses-killed', live, NOW - 40 * 60_000);
    // Exactly the wreckage a `kill -9` leaves behind: an assistant message that
    // never got its `time.completed`, and a tool nobody will ever finish. Both
    // of those read as "running" — only the silence since tells them apart.
    db.prepare(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`)
      .run(
        'msg-killed-asst',
        'ses-killed',
        NOW - 40 * 60_000,
        NOW - 40 * 60_000,
        JSON.stringify({ role: 'assistant', finish: null, time: { created: NOW - 40 * 60_000 } })
      );
    db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        'prt-killed-bash',
        'msg-killed-asst',
        'ses-killed',
        NOW - 40 * 60_000,
        NOW - 40 * 60_000,
        JSON.stringify({ type: 'tool', tool: 'bash', state: { status: 'in_progress' } })
      );
    db.close();
    assert.ok(!activeRootSessionIds(['ses-killed'], NOW).has('ses-killed'), 'nothing written for 40 minutes is not a live turn');
    // ...and the same wreckage, one minute old, is just a slow turn.
    assert.ok(
      activeRootSessionIds(['ses-killed'], NOW - 39 * 60_000).has('ses-killed'),
      'a turn that wrote a minute ago is still running'
    );
    // ...unless the board restarted since: its own agent took the turn down.
    assert.ok(
      !activeRootSessionIds(['ses-killed'], NOW - 39 * 60_000, NOW - 39.5 * 60_000).has('ses-killed'),
      'a turn last written before this board started is not live'
    );
    assert.ok(
      activeRootSessionIds(['ses-thinking'], NOW, NOW - 60_000).has('ses-thinking'),
      'a turn written since the restart still is'
    );
  });

  await t.test('completed recent parts do not keep a session running', () => {
    const db = new DatabaseSync(file);
    db.prepare(`
      INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, summary_files, summary_additions, summary_deletions, agent, tokens_input)
      VALUES (?, 'proj-spa', NULL, ?, 'Just finished', 1, ?, 0, 0, 0, 'Local', 1)
    `).run('ses-done', live, NOW);
    db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        'prt-done',
        'msg-done',
        'ses-done',
        NOW,
        NOW,
        JSON.stringify({ type: 'text', text: 'done', state: { status: 'completed' } })
      );
    db.close();
    const liveNow = activeRootSessionIds(['ses-done', 'ses-diff-yesterday'], NOW);
    assert.ok(!liveNow.has('ses-done'), 'a just-finished turn is idle');
    assert.ok(liveNow.has('ses-diff-yesterday'), 'a running subagent still marks the parent');
  });

  await t.test('the live session is named in its own right, not folded into its root', () => {
    const live = activeSessionIds(['ses-diff-yesterday'], NOW);
    assert.ok(live.has('ses-subagent'), 'the subagent running a tool is the live one');
    assert.ok(!live.has('ses-diff-yesterday'), 'the parent is waiting on it, not running itself');
    assert.ok(!live.has('ses-sub-subagent'), 'a sibling branch with nothing in flight stays idle');
    assert.ok(
      activeRootSessionIds(['ses-diff-yesterday'], NOW).has('ses-diff-yesterday'),
      'the root still counts as busy while a child works'
    );
  });

  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.OPENCODE_DB;
});
