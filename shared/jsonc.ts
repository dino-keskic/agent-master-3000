/**
 * JSON with comments and trailing commas — the `opencode.jsonc` dialect.
 *
 * OpenCode accepts `//` and `/* *\/` comments and trailing commas in its config
 * files, `.json` included, so the board has to as well or a commented config
 * silently loses its context limits. Strings are left alone: a URL's `//` is
 * not a comment.
 */

/** `text` with comments and trailing commas removed, ready for `JSON.parse`. */
export function stripJsonc(text: string): string {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i]!;
    if (c === '"') {
      const start = i++;
      while (i < n && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      out += text.slice(start, ++i);
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    out += c;
    i++;
  }
  // A comma followed only by whitespace before a closing bracket. Strings are
  // already intact, but one could hold `,}` — so walk again, string-aware.
  let result = '';
  for (let j = 0; j < out.length; j++) {
    const c = out[j]!;
    if (c === '"') {
      const start = j++;
      while (j < out.length && out[j] !== '"') j += out[j] === '\\' ? 2 : 1;
      result += out.slice(start, j + 1);
      continue;
    }
    if (c === ',') {
      let k = j + 1;
      while (k < out.length && /\s/.test(out[k]!)) k++;
      if (out[k] === '}' || out[k] === ']') continue;
    }
    result += c;
  }
  return result;
}

/** Parsed JSONC, or undefined if it is not valid even then. */
export function parseJsonc(text: string): unknown {
  try {
    return JSON.parse(stripJsonc(text.replace(/^\uFEFF/, '')));
  } catch {
    return undefined;
  }
}
