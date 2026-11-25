import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';
import { cloneSessionWithoutExcessImages } from '../../../server/opencode/clone.js';
import { closeReadDb } from '../../../server/opencode/db.js';
import { NOW, makeFixture, openCodeId } from '../../fixtures/opencodeDb.js';
import { ROOT, V2_NOW, makeV2Fixture } from '../../fixtures/opencodeDbV2.js';

test('cloneSessionWithoutExcessImages prunes oldest V1 images and failed tails', (t) => {
  const { file, live, root } = makeFixture();
  closeReadDb();
  process.env.OPENCODE_DB = file;
  t.after(() => {
    closeReadDb();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const db = new DatabaseSync(file);
  const sid = 'ses_v1_images';
  const T = NOW + 100_000;
  db.prepare(`
    INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, agent, cost)
    VALUES (?, 'proj-spa', NULL, ?, 'V1 Images', ?, ?, 'build', 0.25)
  `).run(sid, live, T, T);

  const m1 = openCodeId('msg', T + 1);
  const m2 = openCodeId('msg', T + 2);
  db.prepare(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`)
    .run(m1, sid, T + 1, T + 1, JSON.stringify({ role: 'user' }));
  db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(openCodeId('prt', T + 10), m1, sid, T + 1, T + 1, JSON.stringify({
      type: 'file',
      mime: 'image/png',
      filename: 'old.png',
      url: 'data:image/png;base64,aaa'
    }));
  db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(openCodeId('prt', T + 20), m1, sid, T + 2, T + 2, JSON.stringify({
      type: 'file',
      mime: 'image/png',
      filename: 'keep.png',
      url: 'data:image/png;base64,bbb'
    }));
  db.prepare(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`)
    .run(m2, sid, T + 50, T + 50, JSON.stringify({ role: 'user' }));
  db.close();

  const cloned = cloneSessionWithoutExcessImages(sid, undefined, { keepImages: 1, dropSinceMs: T + 40 });
  assert.ok(cloned);
  assert.strictEqual(cloned.removedImages, 1);
  assert.strictEqual(cloned.keptImages, 1);

  const ro = new DatabaseSync(file, { readOnly: true });
  try {
    const msgs = ro.prepare('SELECT id FROM message WHERE session_id = ?').all(cloned.sessionId);
    assert.strictEqual(msgs.length, 1, 'trailing failed prompt dropped');
    const parts = ro.prepare('SELECT data FROM part WHERE session_id = ? ORDER BY id').all(cloned.sessionId) as { data: string }[];
    assert.strictEqual(parts.length, 2);
    assert.strictEqual(JSON.parse(parts[0]!.data).type, 'text');
    assert.strictEqual(JSON.parse(parts[1]!.data).filename, 'keep.png');
  } finally {
    ro.close();
  }
});

test('cloneSessionWithoutExcessImages prunes oldest V2 images and keeps sequence counter monotonic', (t) => {
  const { file } = makeV2Fixture();
  closeReadDb();
  process.env.OPENCODE_DB = file;
  t.after(() => {
    closeReadDb();
    fs.rmSync(file.replace(/\/opencode\.db$/, ''), { recursive: true, force: true });
  });

  const db = new DatabaseSync(file);
  db.prepare(`
    INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
    VALUES ('msg_u_imgs', ?, 'user', 25, ?, ?, ?)
  `).run(
    ROOT,
    V2_NOW + 10,
    V2_NOW + 10,
    JSON.stringify({
      text: 'Look at these',
      files: [
        { name: 'shot1.png', mime: 'image/png', data: '111' },
        { name: 'shot2.png', mime: 'image/png', data: '222' },
        { name: 'shot3.png', mime: 'image/png', data: '333' }
      ]
    })
  );
  db.prepare(`
    INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
    VALUES ('msg_a_err', ?, 'assistant', 26, ?, ?, ?)
  `).run(
    ROOT,
    V2_NOW + 20,
    V2_NOW + 20,
    JSON.stringify({ error: { type: 'unknown', message: 'too many images: max 10, got 12' } })
  );
  db.close();

  const cloned = cloneSessionWithoutExcessImages(ROOT, undefined, { keepImages: 1 });
  assert.ok(cloned);
  assert.strictEqual(cloned.removedImages, 2);
  assert.strictEqual(cloned.keptImages, 1);

  const ro = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = ro.prepare('SELECT seq, data FROM session_message WHERE session_id = ? ORDER BY seq').all(cloned.sessionId) as { seq: number; data: string }[];
    assert.ok(!rows.some((r) => r.seq === 26), 'errored assistant tail dropped');
    const last = JSON.parse(rows[rows.length - 1]!.data);
    assert.strictEqual(last.files.length, 1);
    assert.strictEqual(last.files[0].name, 'shot3.png');
    const counter = ro.prepare('SELECT seq FROM event_sequence WHERE aggregate_id = ?').get(cloned.sessionId) as { seq: number };
    assert.ok(counter.seq >= 26, 'sequence counter stays past dropped seq');
  } finally {
    ro.close();
  }
});
