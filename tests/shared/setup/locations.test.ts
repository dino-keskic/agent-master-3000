import test from 'node:test';
import assert from 'node:assert';
import path from 'path';
import {
  PathContext,
  binCandidates,
  boardConfigFile,
  dataMovePlan,
  opencodeChildEnv,
  opencodeConfigDirs,
  opencodeConfigFiles,
  parseBoardConfig,
  pickChannelDb,
  resolveDataDir,
  resolveLocations
} from '../../../shared/setup/locations.js';

const ctx = (env: NodeJS.ProcessEnv = {}, extra: Partial<PathContext> = {}): PathContext => ({
  env,
  home: '/home/me',
  platform: 'linux',
  cwd: '/work',
  bundled: true,
  ...extra
});

test('with nothing set, every location is where OpenCode puts it', () => {
  const locs = resolveLocations({}, ctx());
  assert.deepStrictEqual(locs.dataDir, { value: '/home/me/.local/share/agent-master-3000', source: 'default' });
  assert.deepStrictEqual(locs.opencodeBin, { value: 'opencode', source: 'default' });
  assert.strictEqual(locs.opencodeConfigDir.value, '/home/me/.config/opencode');
  assert.strictEqual(locs.opencodeDb.value, '/home/me/.local/share/opencode/opencode.db');
  assert.strictEqual(locs.opencodeModels.value, '/home/me/.cache/opencode/models.json');
});

test('the environment beats the setup file, which beats what was found', () => {
  const config = { opencodeBin: '/cfg/opencode', opencodeDb: '/cfg/oc.db' };
  const found = { bin: '/found/opencode', channelDb: '/found/opencode-dev.db' };
  const locs = resolveLocations(config, ctx({ OPENCODE_BIN: '/env/opencode' }), found);
  assert.deepStrictEqual(locs.opencodeBin, { value: '/env/opencode', source: 'env', envVar: 'OPENCODE_BIN' });
  assert.deepStrictEqual(locs.opencodeDb, { value: '/cfg/oc.db', source: 'config' });
  assert.deepStrictEqual(resolveLocations({}, ctx(), found).opencodeBin, { value: '/found/opencode', source: 'detected' });
  assert.deepStrictEqual(resolveLocations({}, ctx(), found).opencodeDb, { value: '/found/opencode-dev.db', source: 'detected' });
});

test('relative environment paths mean what their reader takes them to', () => {
  const locs = resolveLocations({}, ctx({ AGENT_MASTER_DATA_DIR: 'board', OPENCODE_DB: 'other.db' }));
  assert.strictEqual(locs.dataDir.value, '/work/board');
  assert.strictEqual(locs.opencodeDb.value, '/home/me/.local/share/opencode/other.db');
  assert.strictEqual(resolveLocations({}, ctx({ OPENCODE_DB: ':memory:' })).opencodeDb.value, ':memory:');
});

test('the old OPENCODE_MODELS spelling still counts, after OPENCODE_MODELS_PATH', () => {
  assert.strictEqual(resolveLocations({}, ctx({ OPENCODE_MODELS: '/old.json' })).opencodeModels.envVar, 'OPENCODE_MODELS');
  const both = resolveLocations({}, ctx({ OPENCODE_MODELS: '/old.json', OPENCODE_MODELS_PATH: '/new.json' }));
  assert.strictEqual(both.opencodeModels.value, '/new.json');
});

test('extra OpenCode environment moves its defaults too', () => {
  const locs = resolveLocations({ opencodeEnv: { XDG_DATA_HOME: '/xd', XDG_CONFIG_HOME: '/xc' } }, ctx());
  assert.strictEqual(locs.opencodeDb.value, '/xd/opencode/opencode.db');
  assert.strictEqual(locs.opencodeConfigDir.value, '/xc/opencode');
  // The board's own data folder follows the board's environment, not OpenCode's.
  assert.strictEqual(locs.dataDir.value, '/home/me/.local/share/agent-master-3000');
});

test('OpenCode is handed only what the setup file moved', () => {
  const config = { opencodeDb: '/cfg/oc.db', opencodeConfigDir: '/cfg/oc', opencodeEnv: { A: '1' } };
  const locs = resolveLocations(config, ctx({ OPENCODE_MODELS_PATH: '/env/models.json' }));
  assert.deepStrictEqual(opencodeChildEnv(config, locs), { A: '1', OPENCODE_DB: '/cfg/oc.db', OPENCODE_CONFIG_DIR: '/cfg/oc' });
  assert.deepStrictEqual(opencodeChildEnv({}, resolveLocations({}, ctx())), {});
});

test('config files: the global three, the extra folder two, then OPENCODE_CONFIG', () => {
  const g = '/home/me/.config/opencode';
  assert.deepStrictEqual(opencodeConfigFiles(resolveLocations({}, ctx()), {}, ctx()), [
    `${g}/config.json`,
    `${g}/opencode.json`,
    `${g}/opencode.jsonc`
  ]);
  const env = { OPENCODE_CONFIG_DIR: '/extra', OPENCODE_CONFIG: '/one.json' };
  assert.deepStrictEqual(opencodeConfigFiles(resolveLocations({}, ctx(env)), {}, ctx(env)).slice(3), [
    '/extra/opencode.json',
    '/extra/opencode.jsonc',
    '/one.json'
  ]);
});

test('config folders: global always, the extra one only when it differs', () => {
  assert.deepStrictEqual(opencodeConfigDirs(resolveLocations({}, ctx()), {}, ctx()), ['/home/me/.config/opencode']);
  const config = { opencodeConfigDir: '/extra' };
  assert.deepStrictEqual(opencodeConfigDirs(resolveLocations(config, ctx()), config, ctx()), ['/home/me/.config/opencode', '/extra']);
});

test('the executable is looked for on PATH first, then where installers put it, once each', () => {
  const found = binCandidates({ PATH: '/a:rel:/opt/homebrew/bin' }, '/home/me', 'darwin');
  assert.strictEqual(found[0], '/a/opencode');
  assert.ok(!found.some((f) => f.startsWith('rel')));
  assert.ok(found.includes('/home/me/.opencode/bin/opencode'));
  assert.strictEqual(found.filter((f) => f === '/opt/homebrew/bin/opencode').length, 1);
  const win = binCandidates({ PATH: 'C:\\bin' }, 'C:\\Users\\me', 'win32');
  assert.deepStrictEqual(win.slice(0, 2), ['C:\\bin\\opencode.exe', 'C:\\bin\\opencode.cmd']);
});

test('the release database wins; otherwise the newest channel one', () => {
  assert.strictEqual(pickChannelDb([{ name: 'opencode-dev.db', mtimeMs: 9 }, { name: 'opencode.db', mtimeMs: 1 }]), 'opencode.db');
  assert.strictEqual(
    pickChannelDb([{ name: 'opencode-beta.db', mtimeMs: 1 }, { name: 'opencode-dev.db', mtimeMs: 9 }, { name: 'auth.json', mtimeMs: 99 }]),
    'opencode-dev.db'
  );
  assert.strictEqual(pickChannelDb([{ name: 'opencode.db-wal', mtimeMs: 1 }]), undefined);
});

test('a setup file keeps only absolute paths and valid variables', () => {
  assert.deepStrictEqual(parseBoardConfig(null), {});
  assert.deepStrictEqual(parseBoardConfig([]), {});
  assert.deepStrictEqual(
    parseBoardConfig({
      dataDir: '/d',
      opencodeBin: 'relative',
      opencodeDb: 5,
      moveDataFrom: '/old',
      opencodeEnv: { OK: 'v', 'bad key': 'x', NUM: 1 },
      other: true
    }),
    { dataDir: '/d', moveDataFrom: '/old', opencodeEnv: { OK: 'v' } }
  );
});

test('the setup file: override, checkout, installed, Windows', () => {
  assert.strictEqual(boardConfigFile(ctx({ AGENT_MASTER_CONFIG: 'x.json' })), '/work/x.json');
  assert.strictEqual(boardConfigFile(ctx({}, { bundled: false })), '/work/data/config.json');
  assert.strictEqual(boardConfigFile(ctx()), '/home/me/.config/agent-master-3000/config.json');
  assert.strictEqual(boardConfigFile(ctx({ XDG_CONFIG_HOME: '/xc' })), '/xc/agent-master-3000/config.json');
  assert.strictEqual(
    boardConfigFile(ctx({ APPDATA: 'C:\\AppData' }, { platform: 'win32' })),
    path.join('C:\\AppData', 'agent-master-3000', 'config.json')
  );
});

test('the configured data folder sits between the environment and the defaults', () => {
  assert.strictEqual(resolveDataDir({ ...ctx(), configured: '/cfg' }), '/cfg');
  assert.strictEqual(resolveDataDir({ ...ctx({}, { bundled: false }), configured: '/cfg' }), '/cfg');
  assert.strictEqual(resolveDataDir({ ...ctx({ AGENT_MASTER_DATA_DIR: '/env' }), configured: '/cfg' }), '/env');
});

test('a move copies the board last, and never over another board', () => {
  assert.deepStrictEqual(dataMovePlan(['board_state.json', 'attachments', 'board_state.json.logs', 'config.json'], false), [
    'board_state.json.logs',
    'attachments',
    'board_state.json'
  ]);
  assert.deepStrictEqual(dataMovePlan(['board_state.json'], true), []);
  assert.deepStrictEqual(dataMovePlan(['attachments'], false), []);
});
