/**
 * A message cut down to the one or two lines a card or a sidebar row shows,
 * with its inline markdown kept so the preview can still render it.
 *
 * Block structure cannot survive being squeezed onto one line — a heading's
 * `#`, a bullet's `-`, a fence's backticks would print as litter — so it is
 * dropped. Inline markup (`**bold**`, `code`, links) is kept, and a cut that
 * lands inside a span closes it again, so the preview never renders a stray
 * `**` or swallows the rest of the line into code.
 */

/** Lines that are only structure: fences, rules, a table's `|---|` row. */
const STRUCTURE_ONLY = [/^\s*(```|~~~)/, /^\s*([-*_])(\s*\1){2,}\s*$/, /^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*:?-*:?\s*\|?\s*$/];

/** The markers at the start of a line that say what kind of block it is. */
const LINE_PREFIX = /^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d{1,3}[.)]\s+)+/;

/** The message on one line: block markers gone, inline markup kept. */
export function flattenMarkdown(text: string): string {
  return text
    .split('\n')
    .filter((line) => !STRUCTURE_ONLY.some((re) => re.test(line)))
    .map((line) => line.replace(LINE_PREFIX, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** How many times `marker` occurs outside code spans. */
function countOutsideCode(text: string, marker: string): number {
  return text.replace(/`[^`]*`/g, '').split(marker).length - 1;
}

/**
 * Closes whatever a cut left open. Code first: inside an unclosed code span
 * nothing else is markup, and a `**` there must not be counted.
 */
function closeOpenSpans(text: string): string {
  if ((text.match(/`/g) || []).length % 2 === 1) return `${text}\``;
  let closed = text;
  if (countOutsideCode(closed, '**') % 2 === 1) closed += '**';
  if (countOutsideCode(closed, '~~') % 2 === 1) closed += '~~';
  return closed;
}

/**
 * The preview itself, at most `max` characters of source before the ellipsis.
 * Undefined when there is nothing worth showing.
 */
export function markdownPreview(text: string | undefined, max = 160): string | undefined {
  if (!text) return undefined;
  const flat = flattenMarkdown(text);
  if (!flat) return undefined;
  if (flat.length <= max) return flat;
  // Back up out of a half-written link, so its URL does not print as text.
  let cut = flat.slice(0, max).trimEnd();
  const openLink = cut.lastIndexOf('](');
  if (openLink !== -1 && !cut.slice(openLink).includes(')')) {
    const start = cut.lastIndexOf('[', openLink);
    if (start !== -1) cut = cut.slice(0, start).trimEnd();
  }
  return closeOpenSpans(`${cut}…`);
}
