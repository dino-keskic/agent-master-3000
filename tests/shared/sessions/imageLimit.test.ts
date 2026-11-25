import test from 'node:test';
import assert from 'node:assert';
import { imageKeepBudget, parseImageLimitError } from '../../../shared/sessions/imageLimit.js';

test('parseImageLimitError parses OpenCode model image-limit failures', () => {
  const err = parseImageLimitError(
    'Internal error: too many images: maximum allowed for model gemini-4-hydrogen is 10, got 12'
  );
  assert.deepStrictEqual(err, {
    model: 'gemini-4-hydrogen',
    maxAllowed: 10,
    got: 12
  });

  const generic = parseImageLimitError('Too many images: limit of 8 exceeded (got 11)');
  assert.deepStrictEqual(generic, { maxAllowed: 8, got: 11 });

  assert.strictEqual(parseImageLimitError('Context length exceeded'), undefined);
  assert.strictEqual(parseImageLimitError(undefined), undefined);
});

test('imageKeepBudget reserves headroom for upcoming turns and tool screenshots', () => {
  assert.strictEqual(imageKeepBudget(10, 0), 5);
  assert.strictEqual(imageKeepBudget(10, 4), 4);
  assert.strictEqual(imageKeepBudget(10, 8), 2);
  assert.strictEqual(imageKeepBudget(10, 10), 0);
  assert.strictEqual(imageKeepBudget(undefined, 2), 5);
});
