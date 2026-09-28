import test from 'node:test';
import assert from 'node:assert';
import { deriveTaskTitle, elapsed, isAutoTaskTitle, isPlaceholderSessionTitle, shortFileLabels, subagentDisplayName, thinkingLevelOptions } from '../../shared/format.js';
import { formatTurnAttribution, turnAttributionFromMessage } from '../../shared/turns/attribution.js';

const labels = (paths: string[]) => shortFileLabels(paths).map(f => f.label);

test('shortFileLabels', async (t) => {
  await t.test('shows only the basename when it is unambiguous', () => {
    assert.deepStrictEqual(
      labels(['packages/billing/lib/src/foo.dart', 'src/components/Board.tsx']),
      ['foo.dart', 'Board.tsx']
    );
  });

  await t.test('keeps the full path available for the tooltip', () => {
    const path = 'packages/billing/test/features/invoice_export_test.dart';
    assert.deepStrictEqual(shortFileLabels([path]), [
      { label: 'invoice_export_test.dart', path }
    ]);
  });

  await t.test('grows colliding basenames until they are distinct', () => {
    assert.deepStrictEqual(
      labels(['src/index.ts', 'test/index.ts']),
      ['src/index.ts', 'test/index.ts']
    );
  });

  await t.test('grows only the colliding group', () => {
    assert.deepStrictEqual(
      labels(['src/index.ts', 'test/index.ts', 'src/app/main.ts']),
      ['src/index.ts', 'test/index.ts', 'main.ts']
    );
  });

  await t.test('takes as many segments as the collision needs', () => {
    assert.deepStrictEqual(
      labels(['a/shared/util/index.ts', 'b/shared/util/index.ts']),
      ['a/shared/util/index.ts', 'b/shared/util/index.ts']
    );
  });

  await t.test('stops at the shortest depth that separates the group', () => {
    assert.deepStrictEqual(
      labels(['deeply/nested/a/b/c/index.ts', 'deeply/nested/a/b/d/index.ts']),
      ['c/index.ts', 'd/index.ts']
    );
  });

  await t.test('handles a deeply nested path on its own', () => {
    assert.deepStrictEqual(labels(['a/b/c/d/e/f/g/deep.ts']), ['deep.ts']);
  });

  await t.test('handles a file at the repo root', () => {
    assert.deepStrictEqual(labels(['README.md']), ['README.md']);
  });

  await t.test('disambiguates a root file against a nested namesake', () => {
    assert.deepStrictEqual(
      labels(['README.md', 'docs/README.md']),
      ['README.md', 'docs/README.md']
    );
  });

  await t.test('ignores leading and repeated slashes', () => {
    assert.deepStrictEqual(labels(['/abs/path//to/file.ts']), ['file.ts']);
  });

  await t.test('leaves an empty path entry harmless', () => {
    assert.deepStrictEqual(labels(['', 'a/b.ts']), ['', 'b.ts']);
  });

  await t.test('returns an empty list for empty input', () => {
    assert.deepStrictEqual(shortFileLabels([]), []);
  });
});

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
