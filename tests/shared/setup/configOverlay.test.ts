import test from 'node:test';
import assert from 'node:assert';
import {
  MAX_MERGE_DEPTH,
  OverlayEntry,
  configOverlayPath,
  needsConfigOverlay,
  planConfigSlots,
  planOverlayLevel
} from '../../../shared/setup/configOverlay.js';

const file = (name: string): OverlayEntry => ({ name, dir: false });
const dir = (name: string): OverlayEntry => ({ name, dir: true });

test('only OpenCode 2 and later replace the global folder with OPENCODE_CONFIG_DIR', () => {
  assert.strictEqual(needsConfigOverlay('2.0.27'), true);
  assert.strictEqual(needsConfigOverlay('3.1.0'), true);
  assert.strictEqual(needsConfigOverlay('1.18.32'), false);
  assert.strictEqual(needsConfigOverlay(undefined), false);
});

test('the overlay sits beside the state file, so a scratch board has its own', () => {
  assert.strictEqual(configOverlayPath('/repo/data/board_state.json'), '/repo/data/board_state.opencode-config');
  assert.strictEqual(configOverlayPath('/repo/data/board_state.scratch.json'), '/repo/data/board_state.scratch.opencode-config');
});

test('one config file each: the global one loads first and the extra one on top', () => {
  assert.deepStrictEqual(planConfigSlots(['opencode.json'], ['opencode.json']), {
    links: [
      { name: 'opencode.json', side: 'global' },
      { name: 'opencode.jsonc', side: 'extra', from: 'opencode.json' }
    ],
    dropped: []
  });
  assert.deepStrictEqual(planConfigSlots(['opencode.jsonc'], []).links, [
    { name: 'opencode.json', side: 'global', from: 'opencode.jsonc' }
  ]);
  assert.deepStrictEqual(planConfigSlots([], ['opencode.jsonc']).links, [
    { name: 'opencode.json', side: 'extra', from: 'opencode.jsonc' }
  ]);
});

test('one side with both files keeps them both when the other has none', () => {
  assert.deepStrictEqual(planConfigSlots(['opencode.jsonc', 'opencode.json'], []), {
    links: [
      { name: 'opencode.json', side: 'global' },
      { name: 'opencode.jsonc', side: 'global' }
    ],
    dropped: []
  });
});

test('more files than slots: each side keeps the one that wins in its own folder', () => {
  assert.deepStrictEqual(planConfigSlots(['opencode.json', 'opencode.jsonc'], ['opencode.json']), {
    links: [
      { name: 'opencode.json', side: 'global', from: 'opencode.jsonc' },
      { name: 'opencode.jsonc', side: 'extra', from: 'opencode.json' }
    ],
    dropped: [{ side: 'global', name: 'opencode.json' }]
  });
});

test('folders both sides have are merged; anything else comes from the one side, the extra side on a clash', () => {
  const level = planOverlayLevel(
    [file('opencode.json'), dir('agents'), dir('commands'), file('AGENTS.md'), dir('node_modules'), file('package.json')],
    [file('opencode.json'), dir('agents'), dir('skills'), file('AGENTS.md'), dir('node_modules')],
    0
  );
  assert.deepStrictEqual(level.merge, ['agents']);
  assert.deepStrictEqual(level.links, [
    { name: 'opencode.json', side: 'global' },
    { name: 'opencode.jsonc', side: 'extra', from: 'opencode.json' },
    { name: 'AGENTS.md', side: 'extra' },
    { name: 'commands', side: 'global' },
    { name: 'node_modules', side: 'extra' },
    { name: 'package.json', side: 'global' },
    { name: 'skills', side: 'extra' }
  ]);
});

test('below the top a config file name is just a file, and a file never merges with a folder', () => {
  const level = planOverlayLevel([file('opencode.json'), dir('x')], [file('x')], 1);
  assert.deepStrictEqual(level, {
    links: [
      { name: 'opencode.json', side: 'global' },
      { name: 'x', side: 'extra' }
    ],
    merge: [],
    dropped: []
  });
});

test('a folder named like a config file is left out at the top', () => {
  assert.deepStrictEqual(planOverlayLevel([dir('opencode.json')], [], 0).links, []);
});

test('past the merge depth the extra side’s folder is used whole', () => {
  assert.deepStrictEqual(planOverlayLevel([dir('a')], [dir('a')], MAX_MERGE_DEPTH - 1).merge, ['a']);
  assert.deepStrictEqual(planOverlayLevel([dir('a')], [dir('a')], MAX_MERGE_DEPTH), {
    links: [{ name: 'a', side: 'extra' }],
    merge: [],
    dropped: []
  });
});
