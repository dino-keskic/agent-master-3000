import test from 'node:test';
import assert from 'node:assert';
import { linksInPrompt } from '../../../shared/task/promptLinks.js';

test('linksInPrompt takes every link that was typed, and none a fetched block brought', () => {
  const prompt = [
    'Fix [web#9 — Login](https://github.com/acme/web/pull/9), CI: https://github.com/acme/web/actions/runs/5',
    'context https://example.com/spec',
    '',
    '--- web#9 description ---',
    'Closes https://github.com/acme/web/issues/1, see https://example.com/unrelated',
    '--- end web#9 description ---'
  ].join('\n');
  assert.deepStrictEqual(
    linksInPrompt(prompt).map((link) => link.url),
    [
      'https://github.com/acme/web/pull/9',
      'https://github.com/acme/web/actions/runs/5',
      'https://example.com/spec'
    ]
  );
  assert.deepStrictEqual(linksInPrompt(''), []);
  assert.deepStrictEqual(linksInPrompt('no links here'), []);
});
