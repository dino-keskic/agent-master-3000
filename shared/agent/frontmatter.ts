/**
 * YAML-subset frontmatter parser and serializer for OpenCode markdown files
 * (custom agents in `agents/*.md` and skills in `skills/<name>/SKILL.md`).
 *
 * Pure: no filesystem or external YAML dependency. Handles scalars, quotes,
 * block scalars (`|`, `>`), nested mappings, inline arrays/objects, and
 * indented lists (including object items like OpenCode 2's `permissions:`),
 * while preserving unknown keys on round-trip.
 */

export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  body: string;
  hasFrontmatter: boolean;
}

interface Line {
  indent: number;
  text: string;
  raw: string;
}

function stripInlineComment(value: string): string {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (quote) {
      if (ch === '\\' && quote === '"') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#' && (i === 0 || /\s/.test(value[i - 1]!))) {
      return value.slice(0, i).trimEnd();
    }
  }
  return value.trim();
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  return value;
}

function splitTopLevel(text: string, sep: string): string[] {
  const parts: string[] = [];
  let quote: '"' | "'" | null = null;
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === '\\' && quote === '"') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0 && ch === sep) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function findUnquotedColon(text: string): number {
  let quote: '"' | "'" | null = null;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === '\\' && quote === '"') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0 && ch === ':' && (i + 1 === text.length || /\s/.test(text[i + 1]!))) {
      return i;
    }
  }
  return -1;
}

function parseScalar(raw: string): unknown {
  const cleaned = stripInlineComment(raw);
  if (!cleaned) return '';
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    return unquote(cleaned);
  }
  if (cleaned === 'true') return true;
  if (cleaned === 'false') return false;
  if (cleaned === 'null' || cleaned === '~') return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(cleaned)) {
    const num = Number(cleaned);
    if (Number.isFinite(num)) return num;
  }
  if (cleaned.startsWith('[') && cleaned.endsWith(']')) {
    const inner = cleaned.slice(1, -1).trim();
    if (!inner) return [];
    return splitTopLevel(inner, ',').map(parseScalar);
  }
  if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
    const inner = cleaned.slice(1, -1).trim();
    if (!inner) return {};
    const out: Record<string, unknown> = {};
    for (const pair of splitTopLevel(inner, ',')) {
      const idx = findUnquotedColon(pair);
      if (idx <= 0) continue;
      const key = unquote(pair.slice(0, idx).trim());
      out[key] = parseScalar(pair.slice(idx + 1).trim());
    }
    return out;
  }
  return cleaned;
}

function readBlockScalar(lines: Line[], start: number, parentIndent: number, indicator: string): { value: string; next: number } {
  const folded = indicator.startsWith('>');
  const stripTrailing = indicator.endsWith('-');
  const rawLines: { indent: number; text: string }[] = [];
  let blockIndent: number | null = null;
  let i = start;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.text === '') {
      rawLines.push({ indent: 0, text: '' });
      i++;
      continue;
    }
    if (line.indent <= parentIndent) break;
    if (blockIndent === null) blockIndent = line.indent;
    rawLines.push({ indent: line.indent, text: line.raw.slice(Math.min(blockIndent, line.raw.length)) });
    i++;
  }
  while (rawLines.length > 0 && rawLines[rawLines.length - 1]!.text === '') {
    rawLines.pop();
  }
  let value: string;
  if (folded) {
    value = rawLines.map((l) => (l.text === '' ? '\n' : l.text)).join(' ').replace(/ *\n */g, '\n');
  } else {
    value = rawLines.map((l) => l.text).join('\n');
  }
  if (!stripTrailing && value) value += '\n';
  return { value, next: i };
}

function parseBlock(lines: Line[], start: number, minIndent: number): { value: unknown; next: number } {
  let i = start;
  while (i < lines.length && (lines[i]!.text === '' || lines[i]!.text.startsWith('#'))) i++;
  if (i >= lines.length || lines[i]!.indent < minIndent) return { value: {}, next: i };

  if (lines[i]!.text === '-' || lines[i]!.text.startsWith('- ')) {
    return parseList(lines, i, lines[i]!.indent);
  }
  return parseMapping(lines, i, lines[i]!.indent);
}

function parseList(lines: Line[], start: number, listIndent: number): { value: unknown[]; next: number } {
  const items: unknown[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.text === '' || line.text.startsWith('#')) {
      i++;
      continue;
    }
    if (line.indent < listIndent) break;
    if (line.indent > listIndent) break;
    if (line.text !== '-' && !line.text.startsWith('- ')) break;

    const rest = line.text === '-' ? '' : line.text.slice(2).trim();
    i++;
    if (!rest) {
      const nested = parseBlock(lines, i, listIndent + 1);
      items.push(nested.value);
      i = nested.next;
      continue;
    }

    const colon = findUnquotedColon(rest);
    if (colon > 0) {
      const firstKey = unquote(rest.slice(0, colon).trim());
      const afterColon = rest.slice(colon + 1).trim();
      const obj: Record<string, unknown> = {};
      const itemIndent = listIndent + 2;
      if (afterColon === '|' || afterColon === '|-' || afterColon === '>' || afterColon === '>-') {
        const block = readBlockScalar(lines, i, listIndent, afterColon);
        obj[firstKey] = block.value;
        i = block.next;
      } else if (afterColon === '') {
        const nested = parseBlock(lines, i, itemIndent + 1);
        obj[firstKey] = nested.value;
        i = nested.next;
      } else {
        obj[firstKey] = parseScalar(afterColon);
      }
      // Read sibling keys indented under this `- ` item.
      while (i < lines.length) {
        const next = lines[i]!;
        if (next.text === '' || next.text.startsWith('#')) {
          i++;
          continue;
        }
        if (next.indent < itemIndent) break;
        if (next.indent === listIndent && (next.text === '-' || next.text.startsWith('- '))) break;
        const sibling = parseMapping(lines, i, next.indent);
        Object.assign(obj, sibling.value);
        i = sibling.next;
        break;
      }
      items.push(obj);
      continue;
    }

    items.push(parseScalar(rest));
  }
  return { value: items, next: i };
}

function parseMapping(lines: Line[], start: number, mapIndent: number): { value: Record<string, unknown>; next: number } {
  const out: Record<string, unknown> = {};
  let i = start;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.text === '' || line.text.startsWith('#')) {
      i++;
      continue;
    }
    if (line.indent < mapIndent) break;
    if (line.indent > mapIndent) {
      i++;
      continue;
    }
    if (line.text === '-' || line.text.startsWith('- ')) break;

    const colon = findUnquotedColon(line.text);
    if (colon <= 0) {
      i++;
      continue;
    }
    const key = unquote(line.text.slice(0, colon).trim());
    const rest = line.text.slice(colon + 1).trim();
    i++;

    if (rest === '|' || rest === '|-' || rest === '>' || rest === '>-') {
      const block = readBlockScalar(lines, i, mapIndent, rest);
      out[key] = block.value;
      i = block.next;
      continue;
    }
    if (rest === '') {
      let peek = i;
      while (peek < lines.length && (lines[peek]!.text === '' || lines[peek]!.text.startsWith('#'))) peek++;
      if (peek < lines.length && (lines[peek]!.indent > mapIndent || (lines[peek]!.indent === mapIndent && (lines[peek]!.text === '-' || lines[peek]!.text.startsWith('- '))))) {
        const nested = parseBlock(lines, peek, lines[peek]!.indent);
        out[key] = nested.value;
        i = nested.next;
      } else {
        out[key] = '';
      }
      continue;
    }

    out[key] = parseScalar(rest);
  }
  return { value: out, next: i };
}

export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!/^---[ \t]*\n/.test(normalized) && normalized !== '---') {
    return { data: {}, body: normalized, hasFrontmatter: false };
  }
  const firstNewline = normalized.indexOf('\n');
  if (firstNewline < 0) return { data: {}, body: '', hasFrontmatter: false };
  const rest = normalized.slice(firstNewline + 1);
  const closeMatch = /^---[ \t]*(?:\n|$)/m.exec(rest);
  if (!closeMatch) {
    return { data: {}, body: normalized, hasFrontmatter: false };
  }
  const yamlBlock = rest.slice(0, closeMatch.index);
  const body = rest.slice(closeMatch.index + closeMatch[0].length).replace(/^\n+/, '');
  const lines: Line[] = yamlBlock.split('\n').map((line) => {
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;
    return { indent, text: trimmed, raw: line };
  });
  const parsed = parseMapping(lines, 0, 0);
  return {
    data: parsed.value,
    body,
    hasFrontmatter: true
  };
}

function needsQuotes(value: string): boolean {
  if (value === '') return true;
  if (/^\s|\s$/.test(value)) return true;
  if (/^(?:true|false|null|~|-?\d+(?:\.\d+)?)$/i.test(value)) return true;
  if (/^[*&!%@`>|[\]{},#?-]/.test(value)) return true;
  if (/:\s|:$|\s#/.test(value)) return true;
  if (/["'\\\n\r\t]/.test(value)) return true;
  return false;
}

function formatKey(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key) ? key : JSON.stringify(key);
}

function formatScalar(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  const str = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  return needsQuotes(str) ? JSON.stringify(str) : str;
}

function serializeValue(key: string, value: unknown, indent: number): string[] {
  const pad = ' '.repeat(indent);
  const k = formatKey(key);
  if (value === undefined) return [];
  if (typeof value === 'string' && value.includes('\n')) {
    const lines = value.replace(/\n$/, '').split('\n');
    return [`${pad}${k}: |`, ...lines.map((line) => (line ? `${pad}  ${line}` : ''))];
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${pad}${k}: []`];
    const out = [`${pad}${k}:`];
    for (const item of value) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const entries = Object.entries(item as Record<string, unknown>).filter(([, v]) => v !== undefined);
        if (entries.length === 0) {
          out.push(`${pad}  - {}`);
        } else {
          entries.forEach(([subKey, subVal], idx) => {
            const subLines = serializeValue(subKey, subVal, indent + 4);
            if (idx === 0 && subLines.length > 0) {
              out.push(`${pad}  - ${subLines[0]!.trimStart()}`);
              out.push(...subLines.slice(1));
            } else {
              out.push(...subLines);
            }
          });
        }
      } else {
        out.push(`${pad}  - ${formatScalar(item)}`);
      }
    }
    return out;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return [`${pad}${k}: {}`];
    const out = [`${pad}${k}:`];
    for (const [subKey, subVal] of entries) {
      out.push(...serializeValue(subKey, subVal, indent + 2));
    }
    return out;
  }
  return [`${pad}${k}: ${formatScalar(value)}`];
}

export function serializeFrontmatter(
  data: Record<string, unknown>,
  body: string,
  preferredOrder: readonly string[] = []
): string {
  const orderedKeys = [
    ...preferredOrder.filter((key) => Object.prototype.hasOwnProperty.call(data, key)),
    ...Object.keys(data).filter((key) => !preferredOrder.includes(key))
  ];
  const yamlLines: string[] = [];
  for (const key of orderedKeys) {
    yamlLines.push(...serializeValue(key, data[key], 0));
  }
  const cleanBody = body.replace(/^\n+/, '').replace(/\s+$/, '');
  if (yamlLines.length === 0) {
    return cleanBody ? `${cleanBody}\n` : '';
  }
  return cleanBody
    ? `---\n${yamlLines.join('\n')}\n---\n\n${cleanBody}\n`
    : `---\n${yamlLines.join('\n')}\n---\n`;
}
