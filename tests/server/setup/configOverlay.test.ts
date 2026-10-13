import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildConfigOverlay } from '../../../server/setup/configOverlay.js';

/**
 * `server/setup/configOverlay.ts` on a throwaway folder: what the overlay
 * links to, that a rebuild follows the folders it is made of, and that it
 * never reaches through a link into the user's files.
 */

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-overlay-'));
  const global = path.join(root, 'global');
  const extra = path.join(root, 'extra');
  const out = path.join(root, 'board_state.opencode-config');
  const write = (file: string, body = 'x') => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  };
  write(path.join(global, 'opencode.json'), '{"g":1}');
  write(path.join(global, 'agents', 'ceo.md'), 'global ceo');
  write(path.join(global, 'agents', 'shared.md'), 'global shared');
  write(path.join(global, 'commands', 'ship.md'));
  write(path.join(extra, 'opencode.json'), '{"x":1}');
  write(path.join(extra, 'agents', 'extra-one.md'));
  write(path.join(extra, 'agents', 'shared.md'), 'extra shared');
  return { root, global, extra, out, write };
}

test('the overlay loads both folders, the extra one winning a clash', () => {
  const { global, extra, out } = setup();
  assert.strictEqual(buildConfigOverlay(global, extra, out), out);
  assert.deepStrictEqual(fs.readdirSync(path.join(out, 'agents')).sort(), ['ceo.md', 'extra-one.md', 'shared.md']);
  assert.strictEqual(fs.readFileSync(path.join(out, 'agents', 'ceo.md'), 'utf8'), 'global ceo');
  assert.strictEqual(fs.readFileSync(path.join(out, 'agents', 'shared.md'), 'utf8'), 'extra shared');
  assert.strictEqual(fs.readFileSync(path.join(out, 'opencode.json'), 'utf8'), '{"g":1}');
  assert.strictEqual(fs.readFileSync(path.join(out, 'opencode.jsonc'), 'utf8'), '{"x":1}');
  assert.ok(fs.lstatSync(path.join(out, 'commands')).isSymbolicLink());
  assert.ok(!fs.lstatSync(path.join(out, 'agents')).isSymbolicLink());
});

test('a rebuild follows the folders: new files appear, removed ones go, right links stay', () => {
  const { global, extra, out, write } = setup();
  buildConfigOverlay(global, extra, out);
  const before = fs.lstatSync(path.join(out, 'commands')).ino;
  write(path.join(global, 'agents', 'new.md'));
  fs.rmSync(path.join(extra, 'agents', 'extra-one.md'));
  fs.rmSync(path.join(extra, 'opencode.json'));
  buildConfigOverlay(global, extra, out);
  assert.deepStrictEqual(fs.readdirSync(path.join(out, 'agents')).sort(), ['ceo.md', 'new.md', 'shared.md']);
  assert.deepStrictEqual(fs.readdirSync(out).sort(), ['agents', 'commands', 'opencode.json']);
  assert.strictEqual(fs.lstatSync(path.join(out, 'commands')).ino, before);
});

test('clearing the overlay unlinks, and never deletes what a link points at', () => {
  const { global, extra, out } = setup();
  buildConfigOverlay(global, extra, out);
  fs.rmSync(path.join(global, 'commands', 'ship.md'));
  fs.rmdirSync(path.join(global, 'commands'));
  fs.mkdirSync(path.join(extra, 'commands'));
  fs.writeFileSync(path.join(extra, 'commands', 'keep.md'), 'mine');
  // `agents` was a merged folder; make it one side's only, so the merged folder is replaced by a link.
  fs.rmSync(path.join(extra, 'agents'), { recursive: true });
  buildConfigOverlay(global, extra, out);
  assert.ok(fs.lstatSync(path.join(out, 'agents')).isSymbolicLink());
  assert.ok(fs.existsSync(path.join(global, 'agents', 'ceo.md')));
  assert.strictEqual(fs.readFileSync(path.join(out, 'commands', 'keep.md'), 'utf8'), 'mine');
  buildConfigOverlay(global, path.join(path.dirname(extra), 'gone'), out);
  assert.strictEqual(fs.readFileSync(path.join(extra, 'commands', 'keep.md'), 'utf8'), 'mine');
  assert.ok(fs.existsSync(path.join(global, 'agents', 'ceo.md')));
});
