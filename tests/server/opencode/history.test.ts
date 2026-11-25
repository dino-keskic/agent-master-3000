import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';
import { cloneOpenCodeSession } from '../../../server/opencode/clone.js';
import { loadSessionHistory } from '../../../server/opencode/history.js';
import { NOW, makeFixture } from '../../fixtures/opencodeDb.js';

test('OpenCode session history', async (t) => {
  const { file, live, root } = makeFixture();
  process.env.OPENCODE_DB = file;

  await t.test('loadSessionHistory maps OpenCode parts without ACP replay', () => {
    const history = loadSessionHistory('ses-diff-yesterday');
    const types = history.logs.map(l => l.type);
    assert.deepStrictEqual(types, ['user_say', 'thought', 'tool_call', 'agent_say']);
    assert.strictEqual(history.logs[0]!.text, 'Please fix the navbar overflow');
    assert.ok(history.logs[0]!.messageId, 'user prompt carries its OpenCode message id');
    assert.ok(history.logs[3]!.messageId, 'agent answer carries its OpenCode message id');
    assert.strictEqual(history.logs[3]!.text, 'I tightened the flex wrap on the header.');
    assert.deepStrictEqual(history.logs[3]!.metadata, {
      model: 'github-copilot/grok-4.5',
      agent: 'Local',
      thinkingLevel: 'high'
    });
    assert.strictEqual(history.logs[2]!.toolCall?.name, 'read');
    assert.strictEqual(history.logs[2]!.toolCall?.status, 'completed');
    assert.ok(!history.logs.some(l => l.title === 'step-finish'));
  });

  await t.test('a task tool call links to the child session it started', () => {
    const db = new DatabaseSync(file);
    const session = db.prepare(`
      INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, summary_files, summary_additions, summary_deletions, agent, tokens_input)
      VALUES (?, 'proj-spa', ?, ?, ?, ?, ?, 0, 0, 0, ?, 1)
    `);
    session.run('ses-caller', null, live, 'Ship the release', NOW, NOW, 'build');
    session.run('ses-kid-review', 'ses-caller', live, 'Review the diff', NOW + 10, NOW + 10, 'code-reviewer');
    session.run('ses-kid-docs', 'ses-caller', live, 'Update the docs', NOW + 20, NOW + 20, 'general');
    db.prepare(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`)
      .run('msg-caller', 'ses-caller', NOW, NOW, JSON.stringify({ role: 'assistant' }));
    const part = db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`);
    // The first call is stamped with the child id; the second is the older
    // shape that carries nothing but the description it was given.
    part.run('prt-task-1', 'msg-caller', 'ses-caller', NOW + 10, NOW + 10, JSON.stringify({
      type: 'tool',
      tool: 'task',
      callID: 'call-task-1',
      state: {
        status: 'completed',
        input: { description: 'Review the diff', subagent_type: 'code-reviewer' },
        metadata: { sessionID: 'ses-kid-review' },
        output: 'Looks fine'
      }
    }));
    part.run('prt-task-2', 'msg-caller', 'ses-caller', NOW + 20, NOW + 20, JSON.stringify({
      type: 'tool',
      tool: 'task',
      callID: 'call-task-2',
      state: { status: 'completed', input: { description: 'Update the docs' }, output: 'Done' }
    }));
    part.run('prt-read', 'msg-caller', 'ses-caller', NOW + 30, NOW + 30, JSON.stringify({
      type: 'tool',
      tool: 'read',
      callID: 'call-read',
      state: { status: 'completed', input: { filePath: '/tmp/CHANGELOG.md' } }
    }));
    db.close();

    const calls = loadSessionHistory('ses-caller').logs.map((log) => log.toolCall);
    assert.strictEqual(calls[0]?.subagentSessionId, 'ses-kid-review');
    assert.strictEqual(calls[0]?.subagentName, 'code-reviewer');
    assert.strictEqual(calls[1]?.subagentSessionId, 'ses-kid-docs', 'falls back to the child the description names');
    assert.strictEqual(calls[1]?.subagentName, 'general');
    assert.strictEqual(calls[2]?.subagentSessionId, undefined, 'an ordinary tool call opens nothing');
  });

  await t.test('cloneOpenCodeSession forks session, messages, and parts', () => {
    const cloned = cloneOpenCodeSession('ses-diff-yesterday', 'BTW: Header question');
    assert.ok(cloned);
    assert.ok(cloned.sessionId.startsWith('ses_'));
    assert.strictEqual(cloned.costAtFork, 12.4);

    const history = loadSessionHistory(cloned.sessionId);
    assert.ok(history.logs.length >= 1);
    assert.strictEqual(history.logs[0]!.type, 'user_say');
    assert.strictEqual(history.logs[0]!.text, 'Please fix the navbar overflow');
    assert.ok(history.logs.some(l => l.type === 'agent_say' && l.text.includes('flex wrap')));
  });

  await t.test('a handoff files the copy under the new folder and its project', () => {
    const moved = cloneOpenCodeSession('ses-diff-yesterday', 'Fix navbar', { directory: '/code/elsewhere' });
    assert.ok(moved);
    const db = new DatabaseSync(file, { readOnly: true });
    const row = db.prepare('SELECT directory, project_id, title FROM session WHERE id = ?').get(moved.sessionId) as
      Record<string, unknown>;
    const source = db.prepare('SELECT project_id FROM session WHERE id = ?').get('ses-diff-yesterday') as
      Record<string, unknown>;
    db.close();
    assert.strictEqual(row.directory, '/code/elsewhere');
    assert.strictEqual(row.title, 'Fix navbar');
    assert.strictEqual(row.project_id, source.project_id, 'an unknown folder keeps the source project');
    assert.ok(loadSessionHistory(moved.sessionId).logs.length >= 1, 'the conversation came along');
  });

  await t.test('file and image parts render as markdown media logs alongside text parts', () => {
    const db = new DatabaseSync(file);
    db.prepare(`
      INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, summary_files, summary_additions, summary_deletions, agent, tokens_input)
      VALUES ('ses-media', 'proj-spa', NULL, ?, 'Media test', ?, ?, 0, 0, 0, 'build', 1)
    `).run(live, NOW, NOW);
    const msg = db.prepare(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`);
    msg.run('msg-u1', 'ses-media', NOW, NOW, JSON.stringify({ role: 'user' }));
    msg.run('msg-a1', 'ses-media', NOW + 10, NOW + 10, JSON.stringify({ role: 'assistant' }));

    const part = db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`);
    part.run('prt-u-img', 'msg-u1', 'ses-media', NOW, NOW, JSON.stringify({
      type: 'file',
      mime: 'image/png',
      filename: 'bug.png',
      url: 'data:image/png;base64,QUJD'
    }));
    part.run('prt-u-txt', 'msg-u1', 'ses-media', NOW + 1, NOW + 1, JSON.stringify({
      type: 'text',
      text: 'See screenshot'
    }));
    part.run('prt-a-vid', 'msg-a1', 'ses-media', NOW + 10, NOW + 10, JSON.stringify({
      type: 'file',
      mime: 'video/mp4',
      filename: 'fix.mp4',
      url: 'file:///tmp/fix.mp4'
    }));
    // Non-media file part should be skipped.
    part.run('prt-a-txtfile', 'msg-a1', 'ses-media', NOW + 11, NOW + 11, JSON.stringify({
      type: 'file',
      mime: 'text/plain',
      filename: 'notes.txt',
      url: 'file:///tmp/notes.txt'
    }));
    db.close();

    const logs = loadSessionHistory('ses-media').logs;
    assert.deepStrictEqual(
      logs.map((l) => ({ type: l.type, text: l.text })),
      [
        { type: 'user_say', text: '![bug.png](data:image/png;base64,QUJD)' },
        { type: 'user_say', text: 'See screenshot' },
        { type: 'agent_say', text: '![fix.mp4](file:///tmp/fix.mp4)' }
      ]
    );
  });

  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.OPENCODE_DB;
});
