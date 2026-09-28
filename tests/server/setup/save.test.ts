import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

/**
 * `server/setup/locations.ts` against a throwaway home: saving the setup file,
 * what it refuses, what OpenCode is then started with, and the data folder
 * move `server/setup/dataMove.ts` carries out on the next start. Everything the
 * module could look at — HOME, PATH, the setup file, both data folders — is
 * under one temp folder, set before the module is loaded.
 */

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-setup-'));
const home = path.join(root, 'home');
const bin = path.join(root, 'bin');
const boardA = path.join(root, 'boardA');
const boardB = path.join(root, 'boardB');
const configFile = path.join(root, 'config.json');

for (const dir of [home, bin, boardA, boardB]) fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(bin, 'opencode'), '#!/bin/sh\n', { mode: 0o755 });
fs.writeFileSync(path.join(root, 'not-executable'), '', { mode: 0o644 });
fs.writeFileSync(path.join(boardA, 'board_state.json'), '{"tasks":[]}');
fs.mkdirSync(path.join(boardA, 'attachments'));
fs.writeFileSync(path.join(boardA, 'attachments', 'a.png'), 'x');
fs.writeFileSync(configFile, JSON.stringify({ dataDir: boardA }));

process.env.HOME = home;
process.env.PATH = bin;
process.env.AGENT_MASTER_CONFIG = configFile;
for (const name of ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'AGENT_MASTER_DATA_DIR', 'BOARD_STATE_FILE']) delete process.env[name];
for (const name of ['OPENCODE_BIN', 'OPENCODE_CONFIG_DIR', 'OPENCODE_CONFIG', 'OPENCODE_DB', 'OPENCODE_MODELS_PATH', 'OPENCODE_MODELS']) {
  delete process.env[name];
}

const loc = await import('../../../server/setup/locations.js');
const { setupReport } = await import('../../../server/setup/configLayers.js');
const readConfig = () => JSON.parse(fs.readFileSync(configFile, 'utf-8'));

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('the report finds OpenCode on PATH and starts from the configured data folder', () => {
  const report = setupReport();
  const byKey = Object.fromEntries(report.locations.map((l) => [l.key, l]));
  assert.strictEqual(report.configFile, configFile);
  assert.strictEqual(report.dataDirInUse, boardA);
  assert.deepStrictEqual([byKey.opencodeBin!.value, byKey.opencodeBin!.source], [path.join(bin, 'opencode'), 'detected']);
  assert.strictEqual(byKey.dataDir!.hasBoard, true);
  assert.strictEqual(byKey.opencodeDb!.severity, 'warn');
  assert.deepStrictEqual([byKey.opencodeConfigDir!.value, byKey.opencodeConfigDir!.severity], ['', 'ok']);
  assert.deepStrictEqual(report.configLayers.map((l) => [l.kind, l.path]), [
    ['global', path.join(home, '.config', 'opencode')],
    ['board', '']
  ]);
});

test('checking a path cleans it up and judges it', () => {
  assert.strictEqual(loc.checkLocation('opencodeBin', '~/nowhere/opencode ').severity, 'error');
  const ok = loc.checkLocation('opencodeBin', `"${bin}/opencode"`);
  assert.deepStrictEqual([ok.value, ok.severity], [path.join(bin, 'opencode'), 'ok']);
  assert.strictEqual(loc.checkLocation('dataDir', 'relative').severity, 'error');
});

test('a path that cannot do its job is refused and nothing is written', () => {
  const before = fs.readFileSync(configFile, 'utf-8');
  const outcome = loc.saveSetup({ locations: { opencodeBin: path.join(root, 'not-executable') } });
  assert.strictEqual(outcome.ok, false);
  assert.strictEqual(!outcome.ok && outcome.status, 400);
  assert.strictEqual(fs.readFileSync(configFile, 'utf-8'), before);
});

test('moving the sessions database hands it to OpenCode and restarts it', () => {
  const db = path.join(root, 'sessions.db');
  const handle = new DatabaseSync(db);
  handle.exec('CREATE TABLE session (id TEXT)');
  handle.close();
  const notDb = path.join(root, 'plain.db');
  fs.writeFileSync(notDb, 'nope');
  assert.strictEqual(loc.saveSetup({ locations: { opencodeDb: notDb } }).ok, false);

  const outcome = loc.saveSetup({ locations: { opencodeDb: db } });
  assert.deepStrictEqual(outcome, { ok: true, agentChanged: true });
  assert.strictEqual(loc.opencodeDbPath(), db);
  assert.strictEqual(loc.childBaseEnv().OPENCODE_DB, db);
  assert.strictEqual(readConfig().opencodeDb, db);

  assert.deepStrictEqual(loc.saveSetup({ locations: { opencodeDb: null } }), { ok: true, agentChanged: true });
  assert.strictEqual(loc.childBaseEnv().OPENCODE_DB, undefined);
  assert.strictEqual(readConfig().opencodeDb, undefined);
});

test('a location the environment sets cannot be changed from the board', () => {
  process.env.OPENCODE_MODELS_PATH = path.join(root, 'models.json');
  try {
    const outcome = loc.saveSetup({ locations: { opencodeModels: path.join(root, 'other.json') } });
    assert.strictEqual(!outcome.ok && outcome.status, 409);
  } finally {
    delete process.env.OPENCODE_MODELS_PATH;
  }
});

test('extra environment reaches OpenCode, but may not set a location', () => {
  assert.strictEqual(loc.saveSetup({ opencodeEnv: { OPENCODE_DB: '/x' } }).ok, false);
  assert.deepStrictEqual(loc.saveSetup({ opencodeEnv: { HTTPS_PROXY: 'http://p' } }), { ok: true, agentChanged: true });
  assert.strictEqual(loc.childBaseEnv().HTTPS_PROXY, 'http://p');
  assert.deepStrictEqual(loc.saveSetup({ opencodeEnv: { HTTPS_PROXY: 'http://p' } }), { ok: true, agentChanged: false });
  loc.saveSetup({ opencodeEnv: {} });
  assert.strictEqual(readConfig().opencodeEnv, undefined);
});

test('a new data folder asks about the board, and the next start copies it', async () => {
  const asked = loc.saveSetup({ locations: { dataDir: boardB } });
  assert.strictEqual(!asked.ok && asked.needsDataMove, true);

  assert.deepStrictEqual(loc.saveSetup({ locations: { dataDir: boardB }, dataMove: 'move' }), { ok: true, agentChanged: false });
  assert.deepStrictEqual(setupReport().pendingMove, { from: boardA, to: boardB });

  // What `server/index.ts` does first on the next start.
  await import('../../../server/setup/dataMove.js');
  assert.strictEqual(fs.readFileSync(path.join(boardB, 'board_state.json'), 'utf-8'), '{"tasks":[]}');
  assert.ok(fs.existsSync(path.join(boardB, 'attachments', 'a.png')));
  assert.ok(fs.existsSync(path.join(boardA, 'board_state.json')), 'the old copy stays');
  assert.strictEqual(readConfig().moveDataFrom, undefined);
});

test('going back to the folder in use drops a pending move', () => {
  const boardC = path.join(root, 'boardC');
  loc.saveSetup({ locations: { dataDir: boardC }, dataMove: 'move' });
  assert.strictEqual(readConfig().moveDataFrom, boardA);
  loc.saveSetup({ locations: { dataDir: boardA } });
  assert.strictEqual(readConfig().moveDataFrom, undefined);
});
