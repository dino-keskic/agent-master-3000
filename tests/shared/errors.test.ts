import test from 'node:test';
import assert from 'node:assert';
import { errorField, errorMessage } from '../../shared/errors.js';

test('errorMessage', async (t) => {
  await t.test('reads an Error and anything shaped like one', () => {
    assert.strictEqual(errorMessage(new Error('boom')), 'boom');
    assert.strictEqual(errorMessage({ message: 'shaped' }), 'shaped');
  });

  await t.test('is undefined when there is no usable message', () => {
    assert.strictEqual(errorMessage(new Error('')), undefined);
    assert.strictEqual(errorMessage('a string'), undefined);
    assert.strictEqual(errorMessage(undefined), undefined);
    assert.strictEqual(errorMessage(null), undefined);
    assert.strictEqual(errorMessage({ message: 42 }), undefined);
  });
});

test('errorField reads string fields off a child-process failure', () => {
  const failure = Object.assign(new Error('exit 1'), { code: 'ENOENT', stdout: 'rows', status: 1 });
  assert.strictEqual(errorField(failure, 'code'), 'ENOENT');
  assert.strictEqual(errorField(failure, 'stdout'), 'rows');
  assert.strictEqual(errorField(failure, 'status'), undefined);
  assert.strictEqual(errorField(failure, 'stderr'), undefined);
  assert.strictEqual(errorField(42, 'code'), undefined);
});
