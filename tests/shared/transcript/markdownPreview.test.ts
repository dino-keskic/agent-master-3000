import test from 'node:test';
import assert from 'node:assert';
import { flattenMarkdown, markdownPreview } from '../../../shared/transcript/markdownPreview.js';

test('flattenMarkdown', async (t) => {
  await t.test('drops block markers and keeps inline markup', () => {
    const text = '## Summary\n\n- Fixed **the navbar** in `Nav.tsx`\n- Added a test\n\n> quoted\n1. first';
    assert.strictEqual(flattenMarkdown(text), 'Summary Fixed **the navbar** in `Nav.tsx` Added a test quoted first');
  });

  await t.test('drops fences, rules and table separators', () => {
    const text = 'Run:\n```bash\nnpm test\n```\n---\n| a | b |\n|---|:--|\n| 1 | 2 |';
    assert.strictEqual(flattenMarkdown(text), 'Run: npm test | a | b | | 1 | 2 |');
  });

  await t.test('task list boxes go with their bullet', () => {
    assert.strictEqual(flattenMarkdown('- [x] done\n- [ ] next'), 'done next');
  });
});

test('markdownPreview', async (t) => {
  await t.test('short text is returned flat and whole', () => {
    assert.strictEqual(markdownPreview('**Done.**'), '**Done.**');
    assert.strictEqual(markdownPreview('  \n '), undefined);
    assert.strictEqual(markdownPreview(undefined), undefined);
  });

  await t.test('a cut inside bold closes it after the ellipsis', () => {
    assert.strictEqual(markdownPreview('Fixed **the navbar overflow** today', 16), 'Fixed **the navb…**');
  });

  await t.test('a cut inside code closes the code and ignores ** in it', () => {
    assert.strictEqual(markdownPreview('See `a**b and more`', 10), 'See `a**b…`');
  });

  await t.test('a cut inside a link drops the half link', () => {
    assert.strictEqual(markdownPreview('Opened [the PR](https://github.com/acme/web/pull/12) for review', 30), 'Opened…');
  });
});
