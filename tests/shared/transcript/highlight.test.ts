import test from 'node:test';
import assert from 'node:assert';
import { HlToken, highlight, highlightLine, languageFamily, languageFromPath } from '../../../shared/transcript/highlight.js';

/** The pieces carrying a given class, which is what the renderer colours. */
const of = (tokens: HlToken[], cls: string) => tokens.filter((t) => t.cls === cls).map((t) => t.text);
const text = (tokens: HlToken[]) => tokens.map((t) => t.text).join('');

test('languageFamily', () => {
  assert.strictEqual(languageFamily('tsx'), 'c');
  assert.strictEqual(languageFamily('  YAML '), 'yaml');
  assert.strictEqual(languageFamily('brainfuck'), 'plain');
  assert.strictEqual(languageFamily(undefined), 'plain');
});

test('languageFromPath', () => {
  assert.strictEqual(languageFromPath('src/components/Foo.tsx'), 'tsx');
  assert.strictEqual(languageFromPath('package.json'), 'json');
  assert.strictEqual(languageFromPath('docker/Dockerfile'), 'dockerfile');
  assert.strictEqual(languageFromPath('Makefile'), 'makefile');
  assert.strictEqual(languageFromPath('notes.unknownext'), undefined);
  assert.strictEqual(languageFromPath('README'), undefined);
});

test('highlight', async (t) => {
  await t.test('never loses or reorders a character', () => {
    const samples: [string, string][] = [
      ['ts', 'const x = f(1); // hi\n'],
      ['py', 'def f(a):\n    return "s"  # c\n'],
      ['bash', 'ls -la "$HOME" # c\n'],
      ['json', '{"a": 1, "b": [true, null]}'],
      ['yaml', 'key: value # c\nlist:\n  - 1\n'],
      ['sql', "select * from t where a = 'b';"],
      ['diff', '--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n']
    ];
    for (const [lang, code] of samples) {
      assert.strictEqual(text(highlight(code, lang)), code, lang);
    }
  });

  await t.test('colours c-like keywords, calls, strings, numbers and comments', () => {
    const tokens = highlight('const n = 0x1f; // note\nrun("s");', 'ts');
    assert.deepStrictEqual(of(tokens, 'key'), ['const']);
    assert.deepStrictEqual(of(tokens, 'num'), ['0x1f']);
    assert.deepStrictEqual(of(tokens, 'com'), ['// note']);
    assert.deepStrictEqual(of(tokens, 'fn'), ['run']);
    assert.deepStrictEqual(of(tokens, 'str'), ['"s"']);
  });

  await t.test('does not colour keywords inside strings or comments', () => {
    assert.deepStrictEqual(of(highlight('"const"', 'ts'), 'key'), []);
    assert.deepStrictEqual(of(highlight('// const', 'ts'), 'key'), []);
  });

  await t.test('treats shell variables and flags as their own thing', () => {
    const tokens = highlight('cd $HOME --force', 'bash');
    assert.deepStrictEqual(of(tokens, 'key'), ['cd']);
    assert.deepStrictEqual(of(tokens, 'fn'), ['$HOME', '--force']);
  });

  await t.test('reads a json key as a key and a value string as a string', () => {
    const tokens = highlight('{"a": "b"}', 'json');
    assert.deepStrictEqual(of(tokens, 'key'), ['"a"']);
    assert.deepStrictEqual(of(tokens, 'str'), ['"b"']);
  });

  await t.test('reads yaml mapping keys, including under a list dash', () => {
    const tokens = highlight('name: x\n- id: 2\n', 'yaml');
    assert.deepStrictEqual(of(tokens, 'key'), ['name', '- id']);
  });

  await t.test('marks diff lines by their first column', () => {
    const tokens = highlight('--- a\n+++ b\n@@ -1 +1 @@\n-gone\n+here\n ctx\n', 'diff');
    assert.deepStrictEqual(of(tokens, 'add'), ['+here\n']);
    assert.deepStrictEqual(of(tokens, 'del'), ['-gone\n']);
    assert.deepStrictEqual(of(tokens, 'fn'), ['@@ -1 +1 @@\n']);
  });

  await t.test('returns one plain token for unknown, empty and oversized input', () => {
    assert.deepStrictEqual(highlight('x = 1', 'brainfuck'), [{ text: 'x = 1' }]);
    assert.deepStrictEqual(highlight('', 'ts'), []);
    const huge = 'a'.repeat(50_000);
    assert.deepStrictEqual(highlight(huge, 'ts'), [{ text: huge }]);
  });

  await t.test('is not stateful across calls', () => {
    const once = highlight('const a = 1;', 'ts');
    assert.deepStrictEqual(highlight('const a = 1;', 'ts'), once);
  });
});

test('highlightLine', async (t) => {
  await t.test('never loses characters on a typical diff line, with or without a newline', () => {
    const line = '    const msg = fetch("/api"); // added';
    assert.strictEqual(text(highlightLine(line, 'ts')), line);
    assert.strictEqual(text(highlight(line, 'ts')), line);
    assert.strictEqual(text(highlightLine(`${line}\n`, 'ts')), `${line}\n`);
  });

  await t.test('colours keywords and strings on a ts line with no trailing newline', () => {
    const tokens = highlightLine('const n = "s";', 'ts');
    assert.deepStrictEqual(of(tokens, 'key'), ['const']);
    assert.deepStrictEqual(of(tokens, 'str'), ['"s"']);
    assert.strictEqual(text(tokens), 'const n = "s";');
  });
});
