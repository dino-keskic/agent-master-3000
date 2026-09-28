import test from 'node:test';
import assert from 'node:assert';
import { filterInlineOptions, inlineTriggerText } from '../../../shared/composer/inlineSelect.js';

const MODELS = [
  { value: 'anthropic/claude-sonnet-4', label: 'claude-sonnet-4' },
  { value: 'openai/gpt-luna', label: 'gpt-luna' },
  { value: 'wt-1', label: 'feat · login-fix', keywords: '/repos/app-feat' }
];

test('filterInlineOptions', async (t) => {
  await t.test('an empty query returns the very same array', () => {
    assert.strictEqual(filterInlineOptions(MODELS, ''), MODELS);
    assert.strictEqual(filterInlineOptions(MODELS, '   '), MODELS);
  });

  await t.test('every word must match, in any order, ignoring case', () => {
    assert.deepStrictEqual(filterInlineOptions(MODELS, 'SON 4').map((o) => o.value), ['anthropic/claude-sonnet-4']);
    assert.deepStrictEqual(filterInlineOptions(MODELS, 'login feat').map((o) => o.value), ['wt-1']);
    assert.deepStrictEqual(filterInlineOptions(MODELS, 'luna sonnet'), []);
  });

  await t.test('keywords count as matchable text', () => {
    assert.deepStrictEqual(filterInlineOptions(MODELS, 'repos').map((o) => o.value), ['wt-1']);
  });
});

test('inlineTriggerText', async (t) => {
  await t.test('a known value reads as its label', () => {
    assert.deepStrictEqual(inlineTriggerText(MODELS, 'openai/gpt-luna', 'model'), { text: 'gpt-luna', known: true });
  });

  await t.test('a value the list lost keeps its name', () => {
    assert.deepStrictEqual(inlineTriggerText(MODELS, 'build', 'agent'), { text: 'build (unavailable)', known: false });
  });

  await t.test('nothing chosen is the placeholder', () => {
    assert.deepStrictEqual(inlineTriggerText(MODELS, '', 'agent'), { text: 'agent', known: false });
    assert.deepStrictEqual(inlineTriggerText(MODELS, null, 'agent'), { text: 'agent', known: false });
  });
});
