import test from 'node:test';
import assert from 'node:assert';
import { addressCommentsCommand, formatAddressCommentsPrompt } from '../../../shared/review/addressComments.js';
import { comment } from '../../fixtures/changelog.js';

test('formatAddressCommentsPrompt includes ids and skips resolved notes', () => {
  const comments = [
    comment({ id: 'abc', path: 'src/a.ts', body: 'rename this', newLine: 12, snippet: '+ const x = 1' }),
    comment({
      id: 'zzz',
      path: 'src/a.ts',
      body: 'already done',
      resolvedAt: 9,
      replies: [{ id: 'r1', author: 'agent', body: 'fixed', createdAt: 8 }]
    })
  ];
  const prompt = formatAddressCommentsPrompt(comments);
  assert.match(prompt, /Address this changelog comment\b/);
  assert.match(prompt, /respond_to_changelog_comments/);
  assert.match(prompt, /src\/a\.ts:12 · `abc`/);
  assert.match(prompt, /You: rename this/);
  assert.doesNotMatch(prompt, /already done/);
  assert.strictEqual(formatAddressCommentsPrompt([]), '');
});

test('address comments slash command disables when nothing is open', () => {
  const empty = addressCommentsCommand([]);
  assert.strictEqual(empty.disabled, true);
  assert.strictEqual(empty.insert, '');
  const ready = addressCommentsCommand([comment({ id: 'abc', path: 'src/a.ts', body: 'fix' })]);
  assert.strictEqual(ready.disabled, false);
  assert.match(ready.insert, /`abc`/);
});

test('a prompt names folders only when the notes are spread across them', () => {
  const api = comment({ id: 'a', path: 'src/index.ts', body: 'in the api', cwd: '/code/api' });
  const app = comment({ id: 'b', path: 'src/index.ts', body: 'in the app', cwd: '/code/app' });

  // Both notes read `src/index.ts:12` — the folder is the only thing telling
  // the agent which repository it is being asked to change.
  const spread = formatAddressCommentsPrompt([api, app]);
  assert.match(spread, /### \/code\/api\/src\/index\.ts:12 · `a`/);
  assert.match(spread, /### \/code\/app\/src\/index\.ts:12 · `b`/);

  // One folder is the ordinary case: the agent is already working in it.
  assert.match(formatAddressCommentsPrompt([api]), /### src\/index\.ts:12 · `a`/);
});
