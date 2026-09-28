/**
 * Syntax colouring for fenced code in the transcript and for per-line diffs.
 *
 * Deliberately small and dependency-free: agent logs are mostly shell, JSON,
 * diffs and a handful of curly-brace languages, and a real grammar engine would
 * cost more to ship and to run than the extra fidelity is worth here. Anything
 * it does not recognise comes back as one plain token, which renders exactly as
 * it does today.
 *
 * Pure functions over strings — the renderer turns the tokens into spans.
 */

export type TokenClass = 'key' | 'str' | 'num' | 'com' | 'fn' | 'add' | 'del';

export interface HlToken {
  text: string;
  cls?: TokenClass;
}

export type Family = 'c' | 'python' | 'shell' | 'json' | 'yaml' | 'sql' | 'diff' | 'plain';

/** Past this, colouring a block costs more than reading it is worth. */
const MAX_CODE = 40_000;

const C_LIKE = new Set([
  'abstract', 'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'constructor',
  'continue', 'declare', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false',
  'final', 'finally', 'fn', 'for', 'from', 'func', 'function', 'get', 'go', 'if', 'impl',
  'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'match', 'mod', 'mut', 'new',
  'nil', 'null', 'of', 'package', 'private', 'protected', 'pub', 'public', 'readonly', 'return',
  'satisfies', 'self', 'set', 'static', 'struct', 'super', 'switch', 'this', 'throw', 'trait',
  'true', 'try', 'type', 'typeof', 'undefined', 'use', 'var', 'void', 'where', 'while', 'yield'
]);

const PYTHON = new Set([
  'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif',
  'else', 'except', 'False', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
  'lambda', 'None', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'self', 'True', 'try',
  'while', 'with', 'yield'
]);

const SHELL = new Set([
  'alias', 'break', 'case', 'cd', 'continue', 'do', 'done', 'echo', 'elif', 'else', 'esac',
  'exit', 'export', 'fi', 'for', 'function', 'if', 'in', 'local', 'read', 'return', 'set',
  'shift', 'source', 'sudo', 'then', 'unset', 'until', 'while'
]);

const SQL = new Set([
  'and', 'as', 'asc', 'by', 'case', 'create', 'delete', 'desc', 'distinct', 'drop', 'else',
  'end', 'from', 'group', 'having', 'in', 'index', 'inner', 'insert', 'into', 'is', 'join',
  'left', 'limit', 'not', 'null', 'offset', 'on', 'or', 'order', 'outer', 'select', 'set',
  'table', 'then', 'union', 'update', 'values', 'when', 'where', 'with'
]);

const YAML_LITERALS = new Set(['true', 'false', 'null', 'yes', 'no', 'on', 'off', '~']);
const JSON_LITERALS = new Set(['true', 'false', 'null']);

const FAMILIES: Record<string, Family> = {
  js: 'c', jsx: 'c', mjs: 'c', cjs: 'c', ts: 'c', tsx: 'c', javascript: 'c', typescript: 'c',
  java: 'c', c: 'c', h: 'c', cpp: 'c', 'c++': 'c', cs: 'c', csharp: 'c', go: 'c', golang: 'c',
  rust: 'c', rs: 'c', swift: 'c', kotlin: 'c', kt: 'c', php: 'c', scala: 'c', dart: 'c',
  groovy: 'c', proto: 'c',
  py: 'python', python: 'python', rb: 'python', ruby: 'python',
  sh: 'shell', bash: 'shell', zsh: 'shell', shell: 'shell', console: 'shell', terminal: 'shell',
  fish: 'shell', dockerfile: 'shell', docker: 'shell', make: 'shell', makefile: 'shell',
  json: 'json', json5: 'json', jsonc: 'json',
  yaml: 'yaml', yml: 'yaml', toml: 'yaml', ini: 'yaml', conf: 'yaml', env: 'yaml',
  sql: 'sql', psql: 'sql',
  diff: 'diff', patch: 'diff'
};

export function languageFamily(lang?: string): Family {
  if (!lang) return 'plain';
  return FAMILIES[lang.trim().toLowerCase()] ?? 'plain';
}

/** Extensions `languageFamily` does not list, but callers still want an id for. */
const PATH_EXTS: Record<string, string> = {
  css: 'css',
  scss: 'css',
  html: 'html',
  htm: 'html',
  md: 'md',
  markdown: 'md',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp'
};

/**
 * Language id from a file path's name or extension. Unknown paths return
 * `undefined`, which `highlight` treats as plain text.
 */
export function languageFromPath(path: string): string | undefined {
  const base = path.replace(/\\/g, '/').split('/').pop()?.toLowerCase();
  if (!base) return undefined;

  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'dockerfile';
  if (base === 'makefile' || base === 'gnumakefile' || base.startsWith('makefile.')) return 'makefile';

  const dot = base.lastIndexOf('.');
  if (dot <= 0) return undefined;
  const ext = base.slice(dot + 1);
  if (FAMILIES[ext]) return ext;
  return PATH_EXTS[ext];
}

/**
 * One alternation per family.
 *
 * Named groups rather than positions, so a family can leave out the rules it
 * has no use for. Order is the whole trick: comments and strings come first, so
 * a keyword inside either stays part of it rather than being coloured on its
 * own.
 */
const PATTERNS: Record<Exclude<Family, 'plain' | 'diff'>, RegExp> = {
  c: /(?<com>\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(?<str>`(?:\\[\s\S]|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(?<num>\b(?:0[xXbBoO][0-9a-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)\b)|(?<call>[A-Za-z_$][\w$]*(?=\s*\())|(?<word>[A-Za-z_$][\w$]*)/g,
  python: /(?<com>#[^\n]*)|(?<str>"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(?<num>\b(?:0[xXbB][0-9a-fA-F_]+|\d[\d_]*(?:\.\d+)?)\b)|(?<call>[A-Za-z_]\w*(?=\s*\())|(?<word>[A-Za-z_]\w*)/g,
  shell: /(?<com>#[^\n]*)|(?<str>"(?:\\[\s\S]|[^"\\])*"|'[^']*')|(?<call>\$\{[^}\n]*\}|\$[A-Za-z_]\w*|\B--?[A-Za-z][\w-]*)|(?<word>[A-Za-z_]\w*)/g,
  json: /(?<str>"(?:\\.|[^"\\])*")|(?<num>-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(?<word>[A-Za-z]\w*)/g,
  yaml: /(?<com>#[^\n]*)|(?<str>"(?:\\.|[^"\\\n])*"|'[^'\n]*')|(?<call>^[ \t]*(?:-[ \t]+)?[\w.$/-]+(?=[ \t]*:))|(?<num>\b-?\d+(?:\.\d+)?\b)|(?<word>[A-Za-z~]\w*)/gm,
  sql: /(?<com>--[^\n]*|\/\*[\s\S]*?\*\/)|(?<str>'(?:''|[^'])*')|(?<num>\b\d+(?:\.\d+)?\b)|(?<call>[A-Za-z_]\w*(?=\s*\())|(?<word>[A-Za-z_]\w*)/g
};

/** Which bare words are keywords. Families with no keyword list colour none. */
const KEYWORDS: Partial<Record<Family, Set<string>>> = {
  c: C_LIKE,
  python: PYTHON,
  shell: SHELL,
  sql: SQL,
  json: JSON_LITERALS,
  yaml: YAML_LITERALS
};

function push(out: HlToken[], text: string, cls?: TokenClass): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.cls === cls) {
    last.text += text;
    return;
  }
  out.push(cls ? { text, cls } : { text });
}

/** Line-oriented: a diff's meaning is entirely in the first column. */
function highlightDiff(code: string): HlToken[] {
  const out: HlToken[] = [];
  const lines = code.split('\n');
  lines.forEach((line, index) => {
    const text = index === lines.length - 1 ? line : `${line}\n`;
    if (/^(\+\+\+|---)/.test(line)) push(out, text, 'key');
    else if (line.startsWith('@@')) push(out, text, 'fn');
    else if (line.startsWith('+')) push(out, text, 'add');
    else if (line.startsWith('-')) push(out, text, 'del');
    else if (/^(diff |index |new file|deleted file|similarity |rename )/.test(line)) push(out, text, 'com');
    else push(out, text);
  });
  return out;
}

export function highlight(code: string, lang?: string): HlToken[] {
  if (!code) return [];
  if (code.length > MAX_CODE) return [{ text: code }];

  const family = languageFamily(lang);
  if (family === 'plain') return [{ text: code }];
  if (family === 'diff') return highlightDiff(code);

  const pattern = PATTERNS[family];
  const keywords = KEYWORDS[family];
  const out: HlToken[] = [];
  let cursor = 0;
  pattern.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code)) !== null) {
    const groups = match.groups!;
    const whole = match[0];
    if (match.index > cursor) push(out, code.slice(cursor, match.index));
    cursor = match.index + whole.length;

    if (groups.com !== undefined) push(out, whole, 'com');
    else if (groups.str !== undefined) push(out, whole, stringClass(family, code, cursor));
    else if (groups.call !== undefined) {
      // A YAML or JSON `call` is a mapping key, not a function.
      if (family === 'yaml') push(out, whole, 'key');
      else push(out, whole, keywords?.has(whole) ? 'key' : 'fn');
    } else if (groups.num !== undefined) push(out, whole, 'num');
    else if (groups.word !== undefined) push(out, whole, keywords?.has(whole) ? 'key' : undefined);
    else push(out, whole);
  }
  push(out, code.slice(cursor));
  return out;
}

/** One source line. Does not require a trailing newline; never drops characters. */
export function highlightLine(code: string, lang?: string): HlToken[] {
  return highlight(code, lang);
}

/** In JSON a string standing before a colon is a key, and reads better as one. */
function stringClass(family: Family, code: string, after: number): TokenClass {
  if (family !== 'json') return 'str';
  return /^\s*:/.test(code.slice(after, after + 8)) ? 'key' : 'str';
}
