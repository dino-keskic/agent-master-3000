import test from 'node:test';
import assert from 'node:assert';
import { opencodeEnv } from '../../../server/opencode/env.js';

/**
 * `OPENCODE_CONFIG_CONTENT` is the only per-process handle on OpenCode's config,
 * so it is also the board's only way to take a tool out of the model's list.
 * These cover the merging; the sandbox covers that OpenCode honours it.
 */

const parse = (env: NodeJS.ProcessEnv) => JSON.parse(env.OPENCODE_CONFIG_CONTENT || '{}');

test('an empty policy leaves the environment exactly as it was', () => {
  const base = { PATH: '/usr/bin' };
  assert.equal(opencodeEnv(base, {}), base);
  assert.equal(opencodeEnv(base, undefined), base);
});

test("the board's token never reaches the agent", () => {
  const base = { PATH: '/usr/bin', BOARD_TOKEN: 's3cret' };
  assert.deepEqual(opencodeEnv(base, {}), { PATH: '/usr/bin' });
  assert.equal(opencodeEnv(base, { bash: false }).BOARD_TOKEN, undefined);
  assert.equal(base.BOARD_TOKEN, 's3cret');
});

test('a policy becomes a tools overlay', () => {
  const env = opencodeEnv({ PATH: '/usr/bin' }, { bash: false, 'slack_*': false });
  assert.deepEqual(parse(env), { tools: { bash: false, 'slack_*': false } });
  assert.equal(env.PATH, '/usr/bin');
});

test("the user's own overlay survives, and keeps its other keys", () => {
  const base = {
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      model: 'anthropic/claude-sonnet-4-5',
      tools: { webfetch: false, bash: true }
    })
  };
  const merged = parse(opencodeEnv(base, { bash: false }));
  assert.equal(merged.model, 'anthropic/claude-sonnet-4-5');
  // The board's own entry wins for the key it names; the rest is untouched.
  assert.deepEqual(merged.tools, { webfetch: false, bash: false });
});

test('an unparseable overlay is dropped rather than passed on broken', () => {
  const merged = parse(opencodeEnv({ OPENCODE_CONFIG_CONTENT: 'not json' }, { bash: false }));
  assert.deepEqual(merged, { tools: { bash: false } });
});

test('a non-object overlay does not become the config', () => {
  const merged = parse(opencodeEnv({ OPENCODE_CONFIG_CONTENT: '["nope"]' }, { bash: false }));
  assert.deepEqual(merged, { tools: { bash: false } });
});

test('with a policy file, OPENCODE_CONFIG names it and the content carries none of the policy', () => {
  const base = { OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: 'x/y' }), BOARD_TOKEN: 's3cret' };
  const env = opencodeEnv(base, { bash: false }, '/data/board_state.opencode.json');
  assert.equal(env.OPENCODE_CONFIG, '/data/board_state.opencode.json');
  assert.deepEqual(parse(env), { model: 'x/y' });
  assert.equal(env.BOARD_TOKEN, undefined);
});
