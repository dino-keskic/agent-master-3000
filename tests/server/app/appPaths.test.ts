import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { IS_BUNDLED, PACKAGE_ROOT, PRODUCTION_PORT, listenAddress, resolveDataDir } from '../../../server/app/appPaths.js';

const base = { env: {}, cwd: '/work/repo', home: '/home/me', platform: 'linux' as NodeJS.Platform };

test('under tsx the board is not the bundle', () => {
  assert.strictEqual(IS_BUNDLED, false);
});

test('the package root is the folder with the board\'s package.json in it', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')) as { name: string };
  assert.strictEqual(pkg.name, 'agent-master-3000');
});

test('a checkout keeps its data in ./data, as it always has', () => {
  assert.strictEqual(resolveDataDir({ ...base, bundled: false }), path.resolve('/work/repo', 'data'));
});

test('the built app keeps its data in the XDG data directory, not under the cwd', () => {
  assert.strictEqual(resolveDataDir({ ...base, bundled: true }), path.join('/home/me', '.local', 'share', 'agent-master-3000'));
  assert.strictEqual(
    resolveDataDir({ ...base, bundled: true, env: { XDG_DATA_HOME: '/xdg' } }),
    path.join('/xdg', 'agent-master-3000')
  );
});

test('a relative XDG_DATA_HOME is ignored, as the spec says', () => {
  assert.strictEqual(
    resolveDataDir({ ...base, bundled: true, env: { XDG_DATA_HOME: 'rel' } }),
    path.join('/home/me', '.local', 'share', 'agent-master-3000')
  );
});

test('Windows gets LOCALAPPDATA', () => {
  assert.strictEqual(
    resolveDataDir({ ...base, bundled: true, platform: 'win32', env: { LOCALAPPDATA: '/appdata' } }),
    path.join('/appdata', 'agent-master-3000')
  );
});

test('AGENT_MASTER_DATA_DIR wins either way, relative to the cwd', () => {
  for (const bundled of [true, false]) {
    assert.strictEqual(
      resolveDataDir({ ...base, bundled, env: { AGENT_MASTER_DATA_DIR: 'state' } }),
      path.resolve('/work/repo', 'state')
    );
  }
});

test('the port is 3001 from a checkout and PRODUCTION_PORT bundled, unless PORT says otherwise', () => {
  assert.deepStrictEqual(listenAddress({}, false), { port: 3001, host: '127.0.0.1' });
  assert.deepStrictEqual(listenAddress({}, true), { port: PRODUCTION_PORT, host: '127.0.0.1' });
  assert.deepStrictEqual(listenAddress({ PORT: '4321', HOST: '0.0.0.0' }, true), { port: 4321, host: '0.0.0.0' });
  assert.strictEqual(listenAddress({ PORT: 'nope' }, true).port, PRODUCTION_PORT);
});
