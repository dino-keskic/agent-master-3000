import test, { describe } from 'node:test';
import assert from 'node:assert';
import { fileRefLabel, parseFileToken, parseFileUrl, splitFileLinks } from '../../../shared/transcript/fileLinks.js';

const CWD = '/Users/dev/src/agent-master-3000';

/** The single file reference in `text`, or null when there is none. */
function onlyLink(text: string, cwd?: string) {
  const links = splitFileLinks(text, cwd).filter((s) => s.kind === 'file');
  assert.ok(links.length <= 1, `expected at most one link in ${JSON.stringify(text)}`);
  return links[0] ?? null;
}

describe('file:// URLs', () => {
  test('1. Plain URL becomes an absolute path with no line', () => {
    const ref = parseFileUrl('file:///Users/dev/src/app/main.ts');
    assert.deepStrictEqual(ref, { path: '/Users/dev/src/app/main.ts' });
  });

  test('2. #L fragment and line range both resolve to the first line', () => {
    assert.deepStrictEqual(parseFileUrl('file:///a/b/Feature.java#L28'), { path: '/a/b/Feature.java', line: 28 });
    assert.deepStrictEqual(parseFileUrl('file:///a/b/Plan.java#L120-L241'), { path: '/a/b/Plan.java', line: 120 });
  });

  test('3. Colon suffix works too', () => {
    assert.deepStrictEqual(parseFileUrl('file:///a/b/main.ts:42'), { path: '/a/b/main.ts', line: 42 });
  });

  test('4. Percent escapes are decoded, so paths with spaces survive', () => {
    assert.deepStrictEqual(parseFileUrl('file:///Volumes/My%20Stuff/a%20b.ts#L7'), {
      path: '/Volumes/My Stuff/a b.ts',
      line: 7
    });
  });

  test('5. localhost authority is dropped, other schemes are rejected', () => {
    assert.deepStrictEqual(parseFileUrl('file://localhost/etc/hosts.conf'), { path: '/etc/hosts.conf' });
    assert.strictEqual(parseFileUrl('https://example.com/a.ts'), null);
    assert.strictEqual(parseFileUrl('file://'), null);
  });

  test('6. Needs no cwd, and survives the punctuation prose wraps it in', () => {
    const link = onlyLink('See ((file:///a/b/main.ts#L12-L20)).');
    assert.deepStrictEqual(link?.ref, { path: '/a/b/main.ts', line: 12 });
  });
});

describe('Bare paths', () => {
  test('7. Absolute path inside the cwd links, with or without a line', () => {
    assert.deepStrictEqual(parseFileToken(`${CWD}/server/index.ts`, CWD), { path: `${CWD}/server/index.ts` });
    assert.deepStrictEqual(parseFileToken(`${CWD}/server/index.ts:88`, CWD), {
      path: `${CWD}/server/index.ts`,
      line: 88
    });
  });

  test('8. Absolute path with spaces is accepted as a whole token', () => {
    assert.deepStrictEqual(parseFileToken(`${CWD}/docs/design notes.md`, CWD), {
      path: `${CWD}/docs/design notes.md`
    });
  });

  test('9. Absolute path outside the cwd is left alone', () => {
    assert.strictEqual(parseFileToken('/etc/passwd.conf', CWD), null);
    assert.strictEqual(parseFileToken(`${CWD}/server/index.ts`, undefined), null);
  });

  test('10. Relative path with an extension resolves against the cwd', () => {
    assert.deepStrictEqual(parseFileToken('src/components/Header.tsx', CWD), {
      path: `${CWD}/src/components/Header.tsx`
    });
    assert.deepStrictEqual(parseFileToken('./.github/workflows/ci.yml:3', CWD), {
      path: `${CWD}/.github/workflows/ci.yml`,
      line: 3
    });
  });

  test('11. Relative paths need a cwd, a directory and a known extension', () => {
    assert.strictEqual(parseFileToken('src/components/Header.tsx'), null);
    assert.strictEqual(parseFileToken('Header.tsx', CWD), null);
    assert.strictEqual(parseFileToken('src/components/Header', CWD), null);
    assert.strictEqual(parseFileToken('coordinates.x/coordinates.y', CWD), null);
    assert.strictEqual(parseFileToken('../outside/secret.ts', CWD), null);
  });

  test('12. Shapes seen in real transcripts that name nothing on disk', () => {
    // Dart stack frame, elided middle, shell brace expansion.
    assert.strictEqual(parseFileToken('package:dio/src/dio_mixin.dart:564:7', CWD), null);
    assert.strictEqual(parseFileToken('config/.../dev/app-dev.properties', CWD), null);
    assert.strictEqual(parseFileToken('res/layout/tile_{compact,expanded}.xml', CWD), null);
  });
});

describe('Text that must not be linkified', () => {
  const cases = [
    'The build failed. Retry it.',
    'Bumped the dep to v1.2.3 this morning',
    'See https://example.com/docs/setup.md for details',
    'example.com/app/main.js is the bundle',
    'ran `rm -rf /tmp/old.log` to clean up',
    'roughly 3/4 of the suite passes',
    'the ~/.zshrc alias handles it',
    'read the README and/or the notes'
  ];

  for (const [index, text] of cases.entries()) {
    test(`13.${index + 1} ${text}`, () => {
      assert.strictEqual(onlyLink(text, CWD), null);
    });
  }

  test('14. Empty input yields no segments', () => {
    assert.deepStrictEqual(splitFileLinks('', CWD), []);
    assert.deepStrictEqual(splitFileLinks('   ', CWD), [{ kind: 'text', text: '   ' }]);
  });
});

describe('Splitting prose', () => {
  test('15. Surrounding text is preserved exactly around a link', () => {
    const segments = splitFileLinks('Patched src/api.ts:12, then reran.', CWD);
    assert.deepStrictEqual(segments, [
      { kind: 'text', text: 'Patched ' },
      { kind: 'file', text: 'src/api.ts:12', ref: { path: `${CWD}/src/api.ts`, line: 12 } },
      { kind: 'text', text: ', then reran.' }
    ]);
  });

  test('16. Several references in one line are all found', () => {
    const files = splitFileLinks('Touched src/api.ts and server/index.ts today', CWD).filter((s) => s.kind === 'file');
    assert.deepStrictEqual(
      files.map((f) => f.kind === 'file' && f.ref.path),
      [`${CWD}/src/api.ts`, `${CWD}/server/index.ts`]
    );
  });

  test('17. Hover label appends the line number', () => {
    assert.strictEqual(fileRefLabel({ path: '/a/b.ts' }), '/a/b.ts');
    assert.strictEqual(fileRefLabel({ path: '/a/b.ts', line: 9 }), '/a/b.ts:9');
  });
});
