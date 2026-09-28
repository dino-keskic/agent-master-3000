import test from 'node:test';
import assert from 'node:assert';
import { MdBlock, parseInline, parseMarkdown } from '../../../shared/transcript/markdown.js';

const kinds = (blocks: MdBlock[]) => blocks.map((b) => b.kind);

/** The single block a source was expected to produce, narrowed to its kind. */
function only<K extends MdBlock['kind']>(source: string, kind: K): Extract<MdBlock, { kind: K }> {
  const blocks = parseMarkdown(source);
  assert.strictEqual(blocks.length, 1, `expected one block, got ${kinds(blocks).join(', ')}`);
  const block = blocks[0];
  assert.ok(block && block.kind === kind, `expected a ${kind} block`);
  return block as Extract<MdBlock, { kind: K }>;
}

test('parseMarkdown blocks', async (t) => {
  await t.test('splits paragraphs on blank lines and joins soft breaks', () => {
    const blocks = parseMarkdown('one\ntwo\n\nthree');
    assert.deepStrictEqual(blocks, [
      { kind: 'paragraph', text: 'one\ntwo' },
      { kind: 'paragraph', text: 'three' }
    ]);
  });

  await t.test('reads ATX and setext headings', () => {
    assert.deepStrictEqual(parseMarkdown('## Title'), [{ kind: 'heading', level: 2, text: 'Title' }]);
    assert.deepStrictEqual(parseMarkdown('Title\n====='), [{ kind: 'heading', level: 1, text: 'Title' }]);
    // A setext underline outranks a thematic break when it follows paragraph text.
    assert.deepStrictEqual(parseMarkdown('Title\n-----'), [{ kind: 'heading', level: 2, text: 'Title' }]);
  });

  await t.test('keeps fenced code verbatim, including blank lines and markup', () => {
    const blocks = parseMarkdown('```ts\nconst a = 1;\n\n# not a heading\n```');
    assert.deepStrictEqual(blocks, [
      { kind: 'code', lang: 'ts', code: 'const a = 1;\n\n# not a heading' }
    ]);
  });

  await t.test('closes an unterminated fence at end of input', () => {
    // Streaming output arrives mid-fence constantly; it must still render.
    assert.deepStrictEqual(parseMarkdown('```\nhalf a bl'), [
      { kind: 'code', lang: undefined, code: 'half a bl' }
    ]);
  });

  await t.test('parses a pipe table with alignments', () => {
    const blocks = parseMarkdown(
      '| Name | Count |\n| :--- | ----: |\n| a | 1 |\n| b | 2 |'
    );
    assert.deepStrictEqual(blocks, [
      {
        kind: 'table',
        head: ['Name', 'Count'],
        align: ['left', 'right'],
        rows: [['a', '1'], ['b', '2']]
      }
    ]);
  });

  await t.test('keeps escaped pipes inside a cell', () => {
    const table = only('| a | b |\n| --- | --- |\n| x \\| y | z |', 'table');
    assert.deepStrictEqual(table.rows, [['x | y', 'z']]);
  });

  await t.test('pads and trims rows to the header width', () => {
    const table = only('| a | b |\n| --- | --- |\n| 1 |\n| 1 | 2 | 3 |', 'table');
    assert.deepStrictEqual(table.rows, [['1', ''], ['1', '2']]);
  });

  await t.test('marks a list tight only when nothing loosens it', () => {
    assert.strictEqual(only('- a\n- b', 'list').tight, true);
    assert.strictEqual(only('- a\n\n- b', 'list').tight, false);
    assert.strictEqual(only('- a\n\n  still a\n- b', 'list').tight, false);
  });

  await t.test('reads ordered list starts', () => {
    const list = only('3. c\n4. d', 'list');
    assert.strictEqual(list.ordered, true);
    assert.strictEqual(list.start, 3);
  });

  await t.test('reads task list checkboxes', () => {
    const list = only('- [x] done\n- [ ] todo', 'list');
    assert.deepStrictEqual(list.items.map((item) => item.checked), [true, false]);
  });

  await t.test('nests blocks inside list items and quotes', () => {
    const list = only('- outer\n  - inner', 'list');
    assert.strictEqual(list.items[0]?.blocks[1]?.kind, 'list');

    const quote = only('> quoted\n>\n> ```\n> code\n> ```', 'quote');
    assert.deepStrictEqual(kinds(quote.blocks), ['paragraph', 'code']);
  });

  await t.test('reads thematic breaks', () => {
    assert.deepStrictEqual(kinds(parseMarkdown('a\n\n---\n\nb')), ['paragraph', 'rule', 'paragraph']);
  });

  await t.test('survives empty input and truncates oversized input', () => {
    assert.deepStrictEqual(parseMarkdown(''), []);
    // Past the cap the tail is dropped rather than the whole block refused.
    assert.strictEqual(only('x'.repeat(500_000), 'paragraph').text.length, 400_000);
  });
});

test('parseInline', async (t) => {
  await t.test('reads emphasis, strong and strikethrough', () => {
    assert.deepStrictEqual(parseInline('**b** *i* ~~s~~'), [
      { kind: 'strong', children: [{ kind: 'text', text: 'b' }] },
      { kind: 'text', text: ' ' },
      { kind: 'em', children: [{ kind: 'text', text: 'i' }] },
      { kind: 'text', text: ' ' },
      { kind: 'strike', children: [{ kind: 'text', text: 's' }] }
    ]);
  });

  await t.test('leaves snake_case alone', () => {
    assert.deepStrictEqual(parseInline('a_b_c'), [{ kind: 'text', text: 'a_b_c' }]);
  });

  await t.test('does not look inside code spans', () => {
    assert.deepStrictEqual(parseInline('`**not bold**`'), [{ kind: 'code', text: '**not bold**' }]);
  });

  await t.test('reads links, including nested brackets and titles', () => {
    assert.deepStrictEqual(parseInline('[a](http://x)'), [
      { kind: 'link', href: 'http://x', children: [{ kind: 'text', text: 'a' }] }
    ]);
    assert.deepStrictEqual(parseInline('[a [b]](http://x "t")'), [
      { kind: 'link', href: 'http://x', children: [{ kind: 'text', text: 'a [b]' }] }
    ]);
  });

  await t.test('autolinks bare urls without swallowing trailing punctuation', () => {
    assert.deepStrictEqual(parseInline('see https://x.dev/a.'), [
      { kind: 'text', text: 'see ' },
      { kind: 'link', href: 'https://x.dev/a', children: [{ kind: 'text', text: 'https://x.dev/a' }] },
      { kind: 'text', text: '.' }
    ]);
  });

  await t.test('leaves an unclosed delimiter as literal text', () => {
    assert.deepStrictEqual(parseInline('**oops'), [{ kind: 'text', text: '**oops' }]);
  });
});
