/**
 * Finds the file references agents scatter through their prose so the
 * transcript can turn them into "open in my editor" links.
 *
 * Pure string work — no React, no DOM — because the judgement calls here (what
 * counts as a path, what is just prose with a dot in it) are the part worth
 * unit-testing. Calibrated against real OpenCode transcripts, where the common
 * forms are `file://…#L12-L34` markdown links, backticked repo-relative paths,
 * and `path/to/file.ts:42`.
 *
 * The bias is deliberately conservative: a missed link is a smaller sin than
 * turning ordinary prose into something clickable.
 */

export interface FileRef {
  /** Absolute — `POST /api/open` accepts nothing else, and validates it against the board's folders. */
  path: string;
  line?: number;
}

export type FileLinkSegment =
  | { kind: 'text'; text: string }
  | { kind: 'file'; text: string; ref: FileRef };

/**
 * Allowlist rather than "any short extension": it is what keeps `v1.2.3`,
 * `coordinates.x/coordinates.y` and similar prose out of the link path.
 */
const SOURCE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'vue', 'svelte', 'astro',
  'json', 'jsonc', 'json5', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties', 'lock',
  'md', 'mdx', 'txt', 'csv', 'tsv', 'log', 'xml', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'svg',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'scala', 'swift', 'm', 'mm', 'dart', 'lua', 'r', 'jl',
  'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'cs', 'php', 'pl', 'pm', 'ex', 'exs', 'erl', 'hs', 'clj',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'gradle', 'groovy', 'rake', 'podspec', 'gemspec', 'plist',
  'sql', 'prisma', 'graphql', 'gql', 'proto', 'tf', 'tfvars', 'ipynb', 'snap', 'patch', 'diff',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf'
]);

/** Punctuation prose wraps paths in — `(see file:///a/b.ts)`, `src/a.ts,` … */
const LEADING_JUNK = /^[([{<'"*]+/;
const TRAILING_JUNK = /[.,;:!?)\]}>'"*]+$/;

function hasSourceExtension(path: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return false;
  return SOURCE_EXTENSIONS.has(base.slice(dot + 1).toLowerCase());
}

function normalizeCwd(cwd?: string): string | null {
  if (!cwd) return null;
  const trimmed = cwd.replace(/\/+$/, '');
  return trimmed.startsWith('/') ? trimmed : null;
}

/** `a.ts:42`, `a.ts:42:7` and `a.ts#L42` / `a.ts#L42-L60` all mean line 42. */
function splitLineSuffix(token: string): { path: string; line?: number } {
  const hash = /^(.*)#L(\d+)(?:-L?\d+)?$/.exec(token);
  if (hash) return { path: hash[1] ?? '', line: Number(hash[2]) };

  const colon = /^(.*?):(\d+)(?::\d+)?$/.exec(token);
  if (colon && (colon[1] ?? '').length > 0) return { path: colon[1] ?? '', line: Number(colon[2]) };

  return { path: token };
}

function withLine(path: string, line?: number): FileRef {
  return line && line > 0 ? { path, line } : { path };
}

/** Decodes `%20` and friends; a malformed escape means the text was never a URL. */
function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * `file:///abs/path`, optionally `file://localhost/abs/path`, with an optional
 * `#L12` fragment or `:12` suffix. Needs no cwd — it is already absolute, and
 * the server still refuses anything outside the board's folders.
 */
export function parseFileUrl(raw: string): FileRef | null {
  const token = raw.trim();
  if (!/^file:\/\//i.test(token)) return null;

  let rest = token.slice('file://'.length);
  if (!rest.startsWith('/')) {
    const slash = rest.indexOf('/');
    if (slash === -1) return null;
    rest = rest.slice(slash);
  }
  if (rest.includes('?')) rest = rest.slice(0, rest.indexOf('?'));

  const { path, line } = splitLineSuffix(rest);
  const decoded = decode(path);
  if (!decoded || !decoded.startsWith('/') || decoded === '/') return null;

  return withLine(decoded.replace(/\/+$/, ''), line);
}

/**
 * Interprets a whole string as one file reference — for text the renderer
 * already knows is a single token: an inline-code span or a markdown href.
 *
 * Absolute paths must sit inside `cwd`, which is both the spec and the only way
 * to tell a real path from a sentence that happens to contain slashes. Relative
 * paths additionally must carry a known source extension and no whitespace,
 * so `rm -rf /tmp/old.log` never reads as a path.
 */
export function parseFileToken(raw: string, cwd?: string): FileRef | null {
  const token = raw.trim();
  if (!token) return null;
  if (/^file:\/\//i.test(token)) return parseFileUrl(token);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(token)) return null;

  const { path, line } = splitLineSuffix(token);
  if (!path || path.startsWith('~')) return null;

  const root = normalizeCwd(cwd);
  if (!root) return null;

  if (path.startsWith('/')) {
    const clean = path.replace(/\/+$/, '');
    if (clean !== root && !clean.startsWith(`${root}/`)) return null;
    if (/[{}*?]/.test(clean)) return null;
    if (clean.split('/').some((part) => /^\.\.+$/.test(part))) return null;
    if (!hasSourceExtension(clean)) return null;
    return withLine(clean, line);
  }

  if (/\s/.test(path)) return null;
  const relative = path.replace(/^\.\//, '');
  if (!relative.includes('/')) return null;
  if (relative.startsWith('-') || relative.startsWith('/')) return null;
  // Dart stack frames (`package:dio/src/dio_mixin.dart:564`) and shell globs
  // (`res/layout/tile_{compact,expanded}.xml`) look path-shaped but name nothing
  // on disk; both show up in real transcripts.
  if (/[:{}*?]/.test(relative)) return null;
  const parts = relative.split('/');
  if (parts.some((part) => part === '' || /^\.+$/.test(part))) return null;
  // `example.com/app/main.js` is a bare host, not a repo path. A leading dot is
  // fine though — `.github/workflows/ci.yml` is a real one.
  if ((parts[0] ?? '').slice(1).includes('.')) return null;
  if (!hasSourceExtension(relative)) return null;

  return withLine(`${root}/${relative}`, line);
}

/**
 * Splits prose into plain text and file references, whitespace token by
 * whitespace token. Tokenizing this way (rather than scanning for path-shaped
 * substrings) is what keeps the middle of a URL or an identifier from being
 * mistaken for a path.
 */
export function splitFileLinks(text: string, cwd?: string): FileLinkSegment[] {
  const segments: FileLinkSegment[] = [];
  if (!text) return segments;

  const tokens = /\S+/g;
  let plainStart = 0;
  let match: RegExpExecArray | null;

  while ((match = tokens.exec(text)) !== null) {
    const raw = match[0];
    const lead = LEADING_JUNK.exec(raw)?.[0].length ?? 0;
    const value = raw.slice(lead).replace(TRAILING_JUNK, '');
    if (!value) continue;

    const ref = parseFileToken(value, cwd);
    if (!ref) continue;

    const start = match.index + lead;
    if (start > plainStart) segments.push({ kind: 'text', text: text.slice(plainStart, start) });
    segments.push({ kind: 'file', text: value, ref });
    plainStart = start + value.length;
  }

  if (plainStart < text.length) segments.push({ kind: 'text', text: text.slice(plainStart) });
  return segments;
}

/** `/abs/path/file.ts:42` — what a link shows on hover. */
export function fileRefLabel(ref: FileRef): string {
  return ref.line ? `${ref.path}:${ref.line}` : ref.path;
}
