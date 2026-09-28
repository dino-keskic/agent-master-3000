import test from 'node:test';
import assert from 'node:assert';
import { promptHighlights } from '../../../shared/composer/promptHighlights.js';

const joined = (text: string) => promptHighlights(text).map((s) => s.text).join('');

test('promptHighlights', async (t) => {
  await t.test('marks the leading skill, files and ticket links', () => {
    assert.deepStrictEqual(promptHighlights('/release-notes for @src/App.tsx and [PROJ-1 — Login](https://acme.atlassian.net/browse/PROJ-1)'), [
      { kind: 'command', text: '/release-notes' },
      { kind: 'plain', text: ' for ' },
      { kind: 'file', text: '@src/App.tsx' },
      { kind: 'plain', text: ' and ' },
      { kind: 'link', text: '[PROJ-1 — Login](https://acme.atlassian.net/browse/PROJ-1)' }
    ]);
  });

  await t.test('prose is one plain segment, and nothing is a command mid-text', () => {
    assert.deepStrictEqual(promptHighlights('run /compact later'), [{ kind: 'plain', text: 'run /compact later' }]);
    assert.deepStrictEqual(promptHighlights(''), []);
  });

  await t.test('an email address is not a mention', () => {
    assert.deepStrictEqual(promptHighlights('mail me@acme.dev'), [{ kind: 'plain', text: 'mail me@acme.dev' }]);
  });

  await t.test('segments always add back up to the text', () => {
    for (const text of ['  /pdf\n@a @b', '[x](y) [broken](', '/Users/me @', 'a\n\n/skill']) {
      assert.strictEqual(joined(text), text);
    }
  });
});
