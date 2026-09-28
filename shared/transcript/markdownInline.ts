/**
 * The inline scan: what happens inside one block's text.
 *
 * Left to right, first match wins, and code spans win over everything — a
 * backticked `**not bold**` has to come out literal or every path an agent
 * quotes turns into emphasis. The block parser in `markdown.ts` hands each
 * run of text here; nothing in this file knows what a paragraph is.
 */

export type MdInline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; children: MdInline[] }
  | { kind: 'em'; children: MdInline[] }
  | { kind: 'strike'; children: MdInline[] }
  | { kind: 'link'; href: string; children: MdInline[] };

const AUTOLINK = /^(https?:\/\/|www\.)[^\s<>()[\]{}"']+/i;

/** Trailing punctuation almost always belongs to the sentence, not the URL. */
function trimUrl(url: string): string {
  let end = url.length;
  while (end > 0 && '.,;:!?'.includes(url[end - 1]!)) end--;
  // Keep a closing paren only if the URL opened one, so wiki-style links survive.
  while (end > 0 && url[end - 1] === ')' && !url.slice(0, end).includes('(')) end--;
  return url.slice(0, end);
}

/** A scanner reads one inline node at `i`, or declines by returning null. */
type Scan = { node: MdInline; next: number } | null;
type Scanner = (source: string, i: number) => Scan;

/** A code span, whose fence is however many backticks opened it. */
function scanCode(source: string, i: number): Scan {
  if (source[i] !== '`') return null;
  const open = /^`+/.exec(source.slice(i))![0];
  const close = source.indexOf(open, i + open.length);
  if (close === -1) return null;
  return { node: { kind: 'code', text: source.slice(i + open.length, close).trim() }, next: close + open.length };
}

/** `[label](href)`, and the `![alt](src)` image spelling of it. */
function scanLink(source: string, i: number): Scan {
  const isImage = source[i] === '!' && source[i + 1] === '[';
  if (source[i] !== '[' && !isImage) return null;
  const link = matchLink(source, isImage ? i + 1 : i);
  if (!link) return null;
  return {
    node: {
      kind: 'link',
      href: link.href,
      children: link.label ? parseInline(link.label) : [{ kind: 'text', text: link.href }]
    },
    next: link.end
  };
}

/** `<https://…>`, which agents write when a URL would otherwise run on. */
function scanBracketedUrl(source: string, i: number): Scan {
  if (source[i] !== '<') return null;
  const bracketed = /^<((?:https?|file):\/\/[^\s>]+)>/.exec(source.slice(i));
  if (!bracketed) return null;
  const href = bracketed[1]!;
  return { node: { kind: 'link', href, children: [{ kind: 'text', text: href }] }, next: i + bracketed[0].length };
}

function scanStrike(source: string, i: number): Scan {
  if (source[i] !== '~' || source[i + 1] !== '~') return null;
  const end = source.indexOf('~~', i + 2);
  if (end === -1) return null;
  return { node: { kind: 'strike', children: parseInline(source.slice(i + 2, end)) }, next: end + 2 };
}

/** `**strong**` before `*em*`, since the longer run has to win. */
function scanEmphasis(source: string, i: number): Scan {
  const ch = source[i];
  if (ch !== '*' && ch !== '_') return null;

  const strong = matchDelimited(source, i, ch.repeat(2));
  if (strong) return { node: { kind: 'strong', children: parseInline(strong.inner) }, next: strong.end };

  const em = matchDelimited(source, i, ch);
  // `snake_case_names` must not become emphasis, so `_` only opens on a
  // word boundary. `*` is safe either way.
  if (!em || (ch === '_' && /\w/.test(source[i - 1] ?? ''))) return null;
  return { node: { kind: 'em', children: parseInline(em.inner) }, next: em.end };
}

/** A bare URL, which only starts where a word does. */
function scanAutolink(source: string, i: number): Scan {
  const ch = source[i];
  if (ch !== 'h' && ch !== 'w') return null;
  if (i > 0 && /[\w/@.-]/.test(source[i - 1] ?? '')) return null;

  const auto = AUTOLINK.exec(source.slice(i));
  if (!auto) return null;
  const url = trimUrl(auto[0]);
  if (url.length <= 6) return null;

  const href = url.startsWith('www.') ? `https://${url}` : url;
  return { node: { kind: 'link', href, children: [{ kind: 'text', text: url }] }, next: i + url.length };
}

/** Code first: a backticked `**not bold**` has to come out literal. */
const SCANNERS: Scanner[] = [scanCode, scanLink, scanBracketedUrl, scanStrike, scanEmphasis, scanAutolink];

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!|~<>]/;

export function parseInline(source: string): MdInline[] {
  const nodes: MdInline[] = [];
  let text = '';

  const flush = () => {
    if (text) nodes.push({ kind: 'text', text });
    text = '';
  };

  let i = 0;
  while (i < source.length) {
    if (source[i] === '\\' && i + 1 < source.length && ESCAPABLE.test(source[i + 1]!)) {
      text += source[i + 1];
      i += 2;
      continue;
    }

    let scanned: Scan = null;
    for (const scanner of SCANNERS) {
      scanned = scanner(source, i);
      if (scanned) break;
    }

    if (scanned) {
      flush();
      nodes.push(scanned.node);
      i = scanned.next;
      continue;
    }

    text += source[i];
    i++;
  }

  flush();
  return nodes;
}

/** `[label](href)` starting at `start`, tolerating balanced parens and a title. */
function matchLink(source: string, start: number): { label: string; href: string; end: number } | null {
  if (source[start] !== '[') return null;
  let depth = 0;
  let close = -1;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '\\') {
      i++;
      continue;
    }
    if (source[i] === '[') depth++;
    else if (source[i] === ']') {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1 || source[close + 1] !== '(') return null;

  let parens = 0;
  let end = -1;
  for (let i = close + 1; i < source.length; i++) {
    if (source[i] === '\\') {
      i++;
      continue;
    }
    if (source[i] === '(') parens++;
    else if (source[i] === ')') {
      parens--;
      if (parens === 0) {
        end = i;
        break;
      }
    } else if (source[i] === '\n') return null;
  }
  if (end === -1) return null;

  const target = source.slice(close + 2, end).trim();
  const href = (/^(<[^>]*>|[^\s]+)/.exec(target)?.[1] ?? target).replace(/^<|>$/g, '');
  if (!href) return null;
  return { label: source.slice(start + 1, close), href, end: end + 1 };
}

/** The span between a `marker` at `start` and its next unescaped twin. */
function matchDelimited(source: string, start: number, marker: string): { inner: string; end: number } | null {
  const from = start + marker.length;
  if (source.startsWith(marker, start) === false) return null;
  if (/^\s|^$/.test(source.slice(from, from + 1))) return null;
  let i = from;
  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2;
      continue;
    }
    if (source.startsWith(marker, i)) {
      // A run longer than the marker is a different delimiter opening here.
      if (marker.length === 1 && source[i + 1] === marker) {
        i += 2;
        continue;
      }
      const inner = source.slice(from, i);
      if (!inner || /\s$/.test(inner)) return null;
      return { inner, end: i + marker.length };
    }
    if (source[i] === '\n') return null;
    i++;
  }
  return null;
}
