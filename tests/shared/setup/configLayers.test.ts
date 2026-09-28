import test from 'node:test';
import assert from 'node:assert';
import {
  configStamp,
  configWatch,
  describeConfigLayers,
  projectConfigFiles,
  projectConfigFolders
} from '../../../shared/setup/configLayers.js';

test('project config is looked for from the folder up to its git root, nearest first', () => {
  assert.deepStrictEqual(projectConfigFolders('/r/app/pkg', '/r'), ['/r/app/pkg', '/r/app', '/r']);
  assert.deepStrictEqual(projectConfigFiles('/r', '/r'), [
    '/r/opencode.json',
    '/r/opencode.jsonc',
    '/r/.opencode/opencode.json',
    '/r/.opencode/opencode.jsonc'
  ]);
});

test('outside a repository, or with a root that is not above it, the walk goes to the top', () => {
  assert.deepStrictEqual(projectConfigFolders('/a/b'), ['/a/b', '/a', '/']);
  assert.deepStrictEqual(projectConfigFolders('/a/b', '/elsewhere'), ['/a/b', '/a', '/']);
  // A sibling that only shares a prefix is not a parent.
  assert.deepStrictEqual(projectConfigFolders('/ab/c', '/a'), ['/ab/c', '/ab', '/']);
});

test('the watch covers global files, agent folders, and every project', () => {
  const watch = configWatch({
    globalFiles: ['/g/opencode.json'],
    configDirs: ['/g'],
    projects: [{ cwd: '/r', root: '/r' }]
  });
  assert.ok(watch.files.includes('/g/opencode.json'));
  assert.ok(watch.files.includes('/r/.opencode/opencode.jsonc'));
  assert.ok(watch.dirs.includes('/g/agent'));
  assert.ok(watch.dirs.includes('/r/.opencode/agents'));
  // Never the .opencode folder itself: OpenCode installs plugins into it.
  assert.ok(!watch.dirs.includes('/r/.opencode'));
});

test('the stamp changes when a file appears, is written, or goes; not when listed in another order', () => {
  const a = { path: '/a', stat: { mtimeMs: 1, size: 2 } };
  const b = { path: '/b', stat: null };
  const base = configStamp([a, b]);
  assert.strictEqual(configStamp([b, a]), base);
  assert.notStrictEqual(configStamp([a, { path: '/b', stat: { mtimeMs: 1, size: 0 } }]), base);
  assert.notStrictEqual(configStamp([{ path: '/a', stat: { mtimeMs: 5, size: 2 } }, b]), base);
  assert.notStrictEqual(configStamp([{ path: '/a', stat: null }, b]), base);
});

test('layers come in OpenCode merge order, and the global folder is always there', () => {
  const existing = new Set(['/g/opencode.json', '/x/opencode.jsonc', '/r/opencode.json']);
  const layers = describeConfigLayers({
    globalDir: '/g',
    extraDir: '/x',
    configFile: '/one.json',
    projects: [
      { name: 'repo', cwd: '/r', files: ['/r/opencode.json'] },
      { name: 'bare', cwd: '/b', files: [] }
    ],
    toolPolicyCount: 1,
    exists: (file) => existing.has(file)
  });
  assert.deepStrictEqual(layers.map((l) => l.kind), ['global', 'file', 'project', 'project', 'extra', 'board']);
  assert.deepStrictEqual(layers[0]!.files, ['/g/opencode.json']);
  assert.match(layers[0]!.note, /Always loaded/);
  assert.match(layers[1]!.note, /does not exist/);
  assert.match(layers[2]!.note, /only for tasks in this project/);
  assert.match(layers[3]!.note, /No project config/);
  assert.deepStrictEqual(layers[4]!.files, ['/x/opencode.jsonc']);
  assert.match(layers[4]!.note, /not instead of it/);
  assert.match(layers[5]!.note, /1 tool rule from/);
});

test('with nothing extra set there are only the global folder and the board', () => {
  const layers = describeConfigLayers({ globalDir: '/g', projects: [], toolPolicyCount: 0, exists: () => false });
  assert.deepStrictEqual(layers.map((l) => l.kind), ['global', 'board']);
  assert.match(layers[0]!.note, /no opencode\.json yet/);
});
