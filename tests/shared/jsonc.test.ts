import test from 'node:test';
import assert from 'node:assert';
import { parseJsonc, stripJsonc } from '../../shared/jsonc.js';

test('comments of both kinds are dropped', () => {
  const text = '{\n  // the model\n  "model": "x", /* inline */\n  "n": 1\n}';
  assert.deepStrictEqual(parseJsonc(text), { model: 'x', n: 1 });
});

test('a // inside a string is not a comment', () => {
  assert.deepStrictEqual(parseJsonc('{"url": "https://example.com/a"} // tail'), { url: 'https://example.com/a' });
});

test('escaped quotes do not end a string early', () => {
  assert.deepStrictEqual(parseJsonc('{"q": "say \\"//hi\\""}'), { q: 'say "//hi"' });
});

test('trailing commas go, but a ",}" inside a string stays', () => {
  assert.deepStrictEqual(parseJsonc('{"a": [1, 2,], "b": ",}",\n}'), { a: [1, 2], b: ',}' });
});

test('an unterminated block comment eats the rest instead of throwing', () => {
  assert.strictEqual(stripJsonc('{"a": 1} /* never closed'), '{"a": 1} ');
});

test('a byte-order mark is allowed; invalid JSON is undefined', () => {
  assert.deepStrictEqual(parseJsonc('\uFEFF{"a": 1}'), { a: 1 });
  assert.strictEqual(parseJsonc('{nope'), undefined);
});
