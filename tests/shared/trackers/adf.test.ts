import test from 'node:test';
import assert from 'node:assert';
import { adfToMarkdown } from '../../../shared/trackers/adf.js';

const doc = (...content: unknown[]) => ({ type: 'doc', version: 1, content });
const text = (value: string, marks?: unknown[]) => ({ type: 'text', text: value, marks });
const para = (...content: unknown[]) => ({ type: 'paragraph', content });

test('adfToMarkdown renders headings, marks and links', () => {
  const out = adfToMarkdown(
    doc(
      { type: 'heading', attrs: { level: 2 }, content: [text('Problem')] },
      para(
        text('Editing a plan '),
        text('rewrites', [{ type: 'strong' }]),
        text(' history — see '),
        text('the ticket', [{ type: 'link', attrs: { href: 'https://x/1' } }])
      )
    )
  );
  assert.strictEqual(
    out,
    '## Problem\n\nEditing a plan **rewrites** history — see [the ticket](https://x/1)'
  );
});

test('adfToMarkdown numbers ordered lists from their start and indents wrapped items', () => {
  const item = (value: string) => ({ type: 'listItem', content: [para(text(value))] });
  const out = adfToMarkdown(
    doc(
      { type: 'orderedList', attrs: { order: 3 }, content: [item('first'), item('second')] },
      { type: 'bulletList', content: [item('a')] }
    )
  );
  assert.strictEqual(out, '3. first\n4. second\n\n- a');
});

test('adfToMarkdown keeps code blocks fenced and quotes blockquotes', () => {
  const out = adfToMarkdown(
    doc(
      { type: 'codeBlock', attrs: { language: 'ts' }, content: [text('const x = 1;')] },
      { type: 'blockquote', content: [para(text('careful'))] },
      { type: 'rule' }
    )
  );
  assert.strictEqual(out, '```ts\nconst x = 1;\n```\n\n> careful\n\n---');
});

test('adfToMarkdown flattens inline cards, mentions and hard breaks', () => {
  const out = adfToMarkdown(
    doc(
      para(
        { type: 'mention', attrs: { text: '@Ada', id: '1' } },
        text(' see '),
        { type: 'inlineCard', attrs: { url: 'https://x/2' } },
        { type: 'hardBreak' },
        text('next line')
      )
    )
  );
  assert.strictEqual(out, '@Ada see https://x/2\nnext line');
});

test('adfToMarkdown accepts plain strings and refuses to stringify junk', () => {
  assert.strictEqual(adfToMarkdown('  already text  '), 'already text');
  assert.strictEqual(adfToMarkdown(null), '');
  assert.strictEqual(adfToMarkdown(42), '');
  assert.strictEqual(adfToMarkdown(doc({ type: 'mediaSingle', content: [] })), '');
});

test('adfToMarkdown renders a table with a header separator', () => {
  const cell = (value: string) => ({ type: 'tableCell', content: [para(text(value))] });
  const out = adfToMarkdown(
    doc({
      type: 'table',
      content: [
        { type: 'tableRow', content: [cell('a'), cell('b')] },
        { type: 'tableRow', content: [cell('1'), cell('2')] }
      ]
    })
  );
  assert.strictEqual(out, '| a | b |\n| --- | --- |\n| 1 | 2 |');
});
