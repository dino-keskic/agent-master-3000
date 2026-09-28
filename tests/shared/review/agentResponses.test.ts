import test from 'node:test';
import assert from 'node:assert';
import { normalizeChangelogResponses } from '../../../shared/review/agentResponses.js';

test('normalizeChangelogResponses reads the shapes a tool call arrives in', () => {
  assert.deepStrictEqual(
    normalizeChangelogResponses([
      { commentId: 'c1', reply: ' renamed ', status: 'resolved' },
      { commentId: 'c2', body: 'used as reply', resolve: true },
      { commentId: 'c3', resolved: false }
    ]),
    [
      { commentId: 'c1', reply: 'renamed', status: 'resolved' },
      { commentId: 'c2', reply: 'used as reply', status: 'resolved' },
      { commentId: 'c3', reply: undefined, status: 'open' }
    ]
  );

  // A single object, the way an agent reaching for the old tools would send it.
  assert.deepStrictEqual(normalizeChangelogResponses({ commentId: 'c1', reply: 'hi' }), [
    { commentId: 'c1', reply: 'hi', status: undefined }
  ]);

  // Entries that name nothing, or ask for nothing, are not silently "applied".
  assert.deepStrictEqual(normalizeChangelogResponses([{ reply: 'hi' }, { commentId: 'c1' }, null, 7]), []);
  assert.deepStrictEqual(normalizeChangelogResponses(undefined), []);
});

test('normalizeChangelogResponses folds repeats of one comment into a single entry', () => {
  assert.deepStrictEqual(
    normalizeChangelogResponses([
      { commentId: 'c1', reply: 'first' },
      { commentId: 'c1', status: 'resolved' }
    ]),
    [{ commentId: 'c1', reply: 'first', status: 'resolved' }]
  );
});
