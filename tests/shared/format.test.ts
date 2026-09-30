import test from 'node:test';
import assert from 'node:assert';
import { deriveTaskTitle, elapsed, isAutoTaskTitle, isPlaceholderSessionTitle, subagentDisplayName, thinkingLevelOptions } from '../../shared/format.js';
import { formatTurnAttribution, turnAttributionFromMessage } from '../../shared/turns/attribution.js';

test('session and task titles', async (t) => {
  await t.test('placeholder session titles are ignored', () => {
    assert.ok(isPlaceholderSessionTitle('New session - 2026-08-25'));
    assert.ok(isPlaceholderSessionTitle('Untitled session'));
    assert.ok(isPlaceholderSessionTitle('Review PR (@coderabbit subagent)'));
    assert.ok(isPlaceholderSessionTitle(''));
    assert.ok(!isPlaceholderSessionTitle('Fix snackbar positioning'));
  });

  await t.test('subagent labels prefer @name and drop a trailing subagent suffix', () => {
    assert.strictEqual(
      subagentDisplayName('Review PR (@coderabbit-code-reviewer subagent)'),
      '@coderabbit-code-reviewer'
    );
    assert.strictEqual(subagentDisplayName('Nested worker subagent'), 'Nested worker');
    assert.strictEqual(subagentDisplayName(''), 'Subagent');
    assert.strictEqual(subagentDisplayName('subagent'), 'Subagent');
    const long = subagentDisplayName('Please fix the navbar overflow on mobile and also review the header flex wrap');
    assert.ok(long.endsWith('…'));
    assert.ok(long.length < 50);
  });

  await t.test('a prompt-derived card title can be replaced', () => {
    const prompt = 'Please fix the navbar overflow on mobile';
    const title = deriveTaskTitle(prompt);
    assert.ok(isAutoTaskTitle({ title, prompt, originalPrompt: prompt }));
    assert.ok(!isAutoTaskTitle({ title: 'Navbar WIP', prompt, originalPrompt: prompt }));
    assert.ok(!isAutoTaskTitle({ title, prompt, originalPrompt: prompt, titleLocked: true }));
  });
});

test('turn attribution from OpenCode messages', async (t) => {
  await t.test('reads model, agent, and thinking variant', () => {
    assert.deepStrictEqual(
      turnAttributionFromMessage({
        role: 'assistant',
        modelID: 'gpt-5.6-luna',
        providerID: 'github-copilot',
        agent: 'CEO',
        mode: 'CEO',
        variant: 'high'
      }),
      { model: 'github-copilot/gpt-5.6-luna', agent: 'CEO', thinkingLevel: 'high' }
    );
  });

  await t.test('formats a compact log label and skips empty/default thinking', () => {
    assert.strictEqual(
      formatTurnAttribution({ model: 'github-copilot/gpt-5.6-luna', agent: 'CEO', thinkingLevel: 'high' }),
      'CEO · gpt-5.6-luna · high'
    );
    assert.strictEqual(
      formatTurnAttribution({ model: 'github-copilot/claude-sonnet-4.6', thinkingLevel: 'default' }),
      'claude-sonnet-4.6'
    );
    assert.strictEqual(formatTurnAttribution({}), undefined);
  });
});

test('elapsed is compact and zero-padded', () => {
  assert.strictEqual(elapsed(0, 14_000), '14s');
  assert.strictEqual(elapsed(0, 64_000), '1m 04s');
  assert.strictEqual(elapsed(0, 7_380_000), '2h 03m');
  assert.strictEqual(elapsed(10_000, 0), '0s');
});

test('a title from an @-mentioned prompt reads as text, not markdown', () => {
  const prompt = 'Have a look at [SANDBOX-1 — Invoice editor drops line items]'
    + '(https://acme.atlassian.net/browse/SANDBOX-1)';
  assert.strictEqual(
    deriveTaskTitle(prompt),
    'Have a look at SANDBOX-1 — Invoice editor drops line items'
  );
});

test('thinking levels are only ever the ones the model reports', async (t) => {
  await t.test('offers what OpenCode says, under its own names', () => {
    assert.deepStrictEqual(
      thinkingLevelOptions([{ value: 'low', name: 'Low' }, { value: 'max', name: 'Max' }]),
      [
        { value: 'default', label: 'Default' },
        { value: 'low', label: 'Low' },
        { value: 'max', label: 'Max' }
      ]
    );
  });

  // A model with no effort control, or one we have not heard back about yet:
  // inventing "medium" here offers a level the model rejects on send.
  await t.test('invents nothing when there is no list', () => {
    assert.deepStrictEqual(thinkingLevelOptions([]), [{ value: 'default', label: 'Default' }]);
  });
});
