import test from 'node:test';
import assert from 'node:assert';
import {
  isOpencodeAcp,
  parseOpencodeVersion,
  policyDelivery,
  policyDocument,
  policyFilePath
} from '../../../shared/toolCatalog/policyDelivery.js';

test('both versions print their number their own way', () => {
  assert.strictEqual(parseOpencodeVersion('opencode v2.0.24\n'), '2.0.24');
  assert.strictEqual(parseOpencodeVersion('1.18.32\n'), '1.18.32');
  assert.strictEqual(parseOpencodeVersion('opencode v2.1.0-beta.3'), '2.1.0-beta.3');
  assert.strictEqual(parseOpencodeVersion('command not found'), undefined);
});

test('only an OpenCode 2 with OPENCODE_CONFIG free gets the file', () => {
  assert.strictEqual(policyDelivery('2.0.24', {}), 'file');
  assert.strictEqual(policyDelivery('3.0.0', {}), 'file');
  assert.strictEqual(policyDelivery('1.18.32', {}), 'content');
  assert.strictEqual(policyDelivery(undefined, {}), 'content');
  assert.strictEqual(policyDelivery('2.0.24', { OPENCODE_CONFIG: '/home/me/mine.json' }), 'content');
});

test('the file sits beside the state file, so a scratch board has its own', () => {
  assert.strictEqual(policyFilePath('/repo/data/board_state.json'), '/repo/data/board_state.opencode.json');
  assert.strictEqual(
    policyFilePath('/repo/data/board_state.scratch.json'),
    '/repo/data/board_state.scratch.opencode.json'
  );
});

test('the file says what the overlay would, and an empty policy says nothing', () => {
  assert.deepStrictEqual(JSON.parse(policyDocument({ grep: false })), { tools: { grep: false } });
  assert.deepStrictEqual(JSON.parse(policyDocument(undefined)), {});
});

test('only OpenCode itself is asked its version, never a stub agent', () => {
  assert.ok(isOpencodeAcp('/opt/opencode/bin/opencode', ['acp'], '/opt/opencode/bin/opencode'));
  assert.ok(isOpencodeAcp('opencode', ['acp'], '/opt/opencode/bin/opencode'));
  assert.ok(!isOpencodeAcp('node', ['tests/fixtures/fake-agent.mjs'], '/opt/opencode/bin/opencode'));
  assert.ok(!isOpencodeAcp('opencode-wrapper', ['run'], '/opt/opencode/bin/opencode'));
});
