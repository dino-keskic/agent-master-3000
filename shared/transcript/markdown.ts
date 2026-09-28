/**
 * A small markdown parser for agent output.
 *
 * It produces a tree and renders nothing, so the transcript renderer can turn
 * every node into React elements and never has to reach for
 * `dangerouslySetInnerHTML` — model output is data, and this file is what keeps
 * it that way.
 *
 * The dialect is the one agents actually emit: fenced code, ATX and setext
 * headings, blockquotes, thematic breaks, ordered and bullet lists with real
 * nesting, GitHub task lists, GitHub tables with alignment, and inline
 * emphasis, code, strikethrough, links and bare URLs. Reference links,
 * footnotes and HTML blocks are deliberately absent — no agent writes them, and
 * every construct here is one more thing to get wrong.
 *
 * This file is the block level — what a line starts. The scan inside a block's
 * text is `markdownInline.ts`, and both are re-exported from here, so a caller
 * only ever imports `shared/transcript/markdown`.
 */
import { MdInline, parseInline } from './markdownInline.js';

export type { MdInline };
export { parseInline };

export type MdAlign = 'left' | 'center' | 'right';

export interface MdListItem {
  /** Present only for a GitHub task list item; the box state. */
  checked?: boolean;
  blocks: MdBlock[];
}

export type MdBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'code'; code: string; lang?: string }
  | { kind: 'rule' }
  | { kind: 'quote'; blocks: MdBlock[] }
  | { kind: 'list'; ordered: boolean; start: number; tight: boolean; items: MdListItem[] }
  | { kind: 'table'; head: string[]; align: (MdAlign | null)[]; rows: string[][] };

const FENCE = /^(\s{0,3})(`{3,}|~{3,})[ \t]*([^\s`]*)[^\n]*$/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const RULE = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const QUOTE = /^ {0,3}>[ \t]?(.*)$/;
const BULLET = /^(\s*)([-*+])([ \t]+)(.*)$/;
const ORDERED = /^(\s*)(\d{1,9})([.)])([ \t]+)(.*)$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const TASK = /^\[([ xX])\][ \t]+(.*)$/;

/** A `|---|:--:|` row, which is what turns the line above it into a header. */
const DELIMITER = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

/** Runaway input is a rendering problem, not a parsing one — bail before it costs anything. */
const MAX_SOURCE = 400_000;

function isBlank(line: string): boolean {
  return line.trim() === '';
}

/** Split a table row on unescaped pipes, dropping the optional leading and trailing ones. */
function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && line[i + 1] === '|') {
      cell += '|';
      i++;
      continue;
    }
    if (ch === '|') {
      cells.push(cell);
      cell = '';
      continue;
    }
    cell += ch;
  }
  cells.push(cell);
  if (cells.length && cells[0]!.trim() === '') cells.shift();
  if (cells.length && cells[cells.length - 1]!.trim() === '') cells.pop();
  return cells.map((value) => value.trim());
}

function alignments(line: string): (MdAlign | null)[] {
  return splitRow(line).map((spec) => {
    const left = spec.startsWith(':');
    const right = spec.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return null;
  });
}

/** True if the line opens a block that a paragraph cannot swallow. */
function startsBlock(line: string): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    BULLET.test(line) ||
    ORDERED.test(line)
  );
}

/** A scanner reads one block starting at `from` and says where it ended. */
type Scan = [block: MdBlock | null, next: number];

/**
 * A fenced code block. The closing fence has to match the opening marker and be
 * at least as long, so a ``` inside a ~~~~ block is content rather than an end.
 */
function scanFence(lines: string[], from: number, fence: RegExpExecArray): Scan {
  const marker = fence[2]!;
  const indent = (fence[1] ?? '').length;
  const body: string[] = [];
  let i = from + 1;

  while (i < lines.length) {
    const candidate = lines[i] ?? '';
    const closing = /^\s{0,3}(`{3,}|~{3,})[ \t]*$/.exec(candidate);
    if (closing && closing[1]![0] === marker[0] && closing[1]!.length >= marker.length) {
      i++;
      break;
    }
    // Indented fences carry that indent on every line; take it back off so a
    // block nested in a list item is not rendered pre-indented.
    body.push(candidate.slice(0, indent).trim() === '' ? candidate.slice(indent) : candidate);
    i++;
  }

  return [{ kind: 'code', code: body.join('\n'), lang: fence[3] || undefined }, i];
}

/** A `>` quote, and the blocks inside it — which are parsed the same way. */
function scanQuote(lines: string[], from: number): Scan {
  const inner: string[] = [];
  let i = from;

  while (i < lines.length) {
    const quoted = QUOTE.exec(lines[i] ?? '');
    if (quoted) {
      inner.push(quoted[1] ?? '');
      i++;
      continue;
    }
    // Lazy continuation: an unmarked line still belongs to the quote's
    // paragraph, which is how people actually wrap quoted text.
    if (!isBlank(lines[i] ?? '') && !startsBlock(lines[i] ?? '')) {
      inner.push(lines[i] ?? '');
      i++;
      continue;
    }
    break;
  }

  return [{ kind: 'quote', blocks: parseBlocks(inner) }, i];
}

/** A pipe table: a header row, its delimiter, and the rows under them. */
function scanTable(lines: string[], from: number): Scan {
  const head = splitRow(lines[from] ?? '');
  const align = alignments(lines[from + 1] ?? '');
  const rows: string[][] = [];
  let i = from + 2;

  while (i < lines.length && !isBlank(lines[i] ?? '') && (lines[i] ?? '').includes('|')) {
    const cells = splitRow(lines[i] ?? '');
    // Ragged rows are common in hand-written tables; pad rather than drop.
    while (cells.length < head.length) cells.push('');
    rows.push(cells.slice(0, Math.max(head.length, 1)));
    i++;
  }

  return [{ kind: 'table', head, align, rows }, i];
}

/**
 * A paragraph, which runs until a blank line or a block that outranks it — or
 * the heading it turns out to be, when the line below it is a setext underline.
 */
function scanParagraph(lines: string[], from: number): Scan {
  const paragraph: string[] = [];
  let i = from;

  while (i < lines.length && !isBlank(lines[i] ?? '')) {
    const current = lines[i] ?? '';
    // A setext underline outranks a thematic break: `---` under a line of
    // text is an H2, not a rule with a stray paragraph above it.
    const setext = paragraph.length > 0 ? SETEXT.exec(current) : null;
    if (setext) {
      return [
        { kind: 'heading', level: setext[1]!.startsWith('=') ? 1 : 2, text: paragraph.join(' ') },
        i + 1
      ];
    }
    if (paragraph.length > 0 && startsBlock(current)) break;
    paragraph.push(current);
    i++;
  }

  return [paragraph.length > 0 ? { kind: 'paragraph', text: paragraph.join('\n') } : null, i];
}

/** True when the row under `index` turns it into a table header. */
function isTableHeader(lines: string[], index: number): boolean {
  const next = lines[index + 1] ?? '';
  return (lines[index] ?? '').includes('|') && DELIMITER.test(next) && next.includes('-');
}

/**
 * The block level: each line either starts something, continues what is open,
 * or ends it. Every kind that spans more than one line has its own scanner,
 * which reports where it stopped.
 */
function parseBlocks(lines: string[]): MdBlock[] {
  const blocks: MdBlock[] = [];
  let i = 0;

  const take = ([block, next]: Scan) => {
    if (block) blocks.push(block);
    i = next;
  };

  while (i < lines.length) {
    const line = lines[i] ?? '';

    if (isBlank(line)) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      take(scanFence(lines, i, fence));
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2] ?? '' });
      i++;
      continue;
    }

    // Before the list check: `---` is a rule, but `- item` is not.
    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      take(scanQuote(lines, i));
      continue;
    }

    if (isTableHeader(lines, i)) {
      take(scanTable(lines, i));
      continue;
    }

    if (BULLET.test(line) || ORDERED.test(line)) {
      const [list, next] = parseList(lines, i);
      blocks.push(list);
      i = next;
      continue;
    }

    take(scanParagraph(lines, i));
  }

  return blocks;
}

/** Marker geometry for the list item starting at `index`, or null if there is none. */
function itemAt(line: string): { indent: number; ordered: boolean; number: number; content: number; text: string } | null {
  const ordered = ORDERED.exec(line);
  if (ordered) {
    const indent = ordered[1]!.length;
    return {
      indent,
      ordered: true,
      number: Number(ordered[2]),
      content: indent + ordered[2]!.length + 1 + ordered[4]!.length,
      text: ordered[5] ?? ''
    };
  }
  const bullet = BULLET.exec(line);
  if (bullet) {
    const indent = bullet[1]!.length;
    return {
      indent,
      ordered: false,
      number: 1,
      content: indent + 1 + bullet[3]!.length,
      text: bullet[4] ?? ''
    };
  }
  return null;
}

function parseList(lines: string[], from: number): [Extract<MdBlock, { kind: 'list' }>, number] {
  const first = itemAt(lines[from] ?? '')!;
  const items: MdListItem[] = [];
  let tight = true;
  let i = from;
  let sawBlank = false;

  while (i < lines.length) {
    const marker = itemAt(lines[i] ?? '');
    // A deeper marker belongs to the item being built, not to this list; a
    // shallower one ends it, and so does a switch between bullets and numbers.
    if (!marker || marker.indent < first.indent || marker.ordered !== first.ordered) break;
    if (marker.indent > first.indent) break;
    if (sawBlank) tight = false;

    const own: string[] = [marker.text];
    i++;
    while (i < lines.length) {
      const line = lines[i] ?? '';
      if (isBlank(line)) {
        // A blank line only stays inside the item if indented content follows it.
        const after = itemAt(lines[i + 1] ?? '');
        const continues =
          (lines[i + 1] ?? '').startsWith(' '.repeat(marker.content)) ||
          (after && after.indent >= marker.content);
        if (!continues) {
          sawBlank = true;
          i++;
          break;
        }
        own.push('');
        i++;
        continue;
      }
      const nested = itemAt(line);
      if (nested && nested.indent <= marker.indent) break;
      if (line.startsWith(' '.repeat(marker.content))) {
        own.push(line.slice(marker.content));
        i++;
        continue;
      }
      // Lazy continuation of the item's paragraph.
      if (!nested && !startsBlock(line)) {
        own.push(line.trim());
        i++;
        continue;
      }
      break;
    }

    const task = TASK.exec(own[0] ?? '');
    if (task) own[0] = task[2] ?? '';
    const blocks = parseBlocks(own);
    // An item holding more than one block needs the room a loose list gives it,
    // whatever the blank lines between items said.
    if (blocks.length > 1) tight = false;
    items.push({
      checked: task ? task[1]!.toLowerCase() === 'x' : undefined,
      blocks
    });
  }

  return [
    { kind: 'list', ordered: first.ordered, start: first.ordered ? first.number : 1, tight, items },
    i
  ];
}

export function parseMarkdown(source: string): MdBlock[] {
  if (!source) return [];
  const text = source.length > MAX_SOURCE ? source.slice(0, MAX_SOURCE) : source;
  return parseBlocks(text.replace(/\r\n?/g, '\n').split('\n'));
}
