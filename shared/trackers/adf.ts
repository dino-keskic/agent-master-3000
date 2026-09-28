/**
 * Atlassian Document Format → Markdown.
 *
 * Jira returns descriptions as an ADF tree, not text. The board pastes those
 * descriptions into prompts, so they have to come out as something an agent can
 * read: headings, lists, code fences and links, not a JSON blob.
 */

interface AdfMark {
  type?: string;
  attrs?: Record<string, unknown>;
}

interface AdfNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: AdfMark[];
  content?: AdfNode[];
}

function isNode(value: unknown): value is AdfNode {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function attr(node: AdfNode, name: string): string {
  const value = node.attrs?.[name];
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

/** Wrap `text` in the inline syntax for each mark, innermost first. */
function applyMarks(text: string, marks: AdfMark[] | undefined): string {
  let out = text;
  for (const mark of marks || []) {
    if (mark.type === 'code') out = `\`${out}\``;
    else if (mark.type === 'strong') out = `**${out}**`;
    else if (mark.type === 'em') out = `*${out}*`;
    else if (mark.type === 'strike') out = `~~${out}~~`;
    else if (mark.type === 'link') {
      const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '';
      if (href) out = `[${out}](${href})`;
    }
  }
  return out;
}

function inline(nodes: AdfNode[] | undefined): string {
  return (nodes || []).map(inlineNode).join('');
}

function inlineNode(node: AdfNode): string {
  if (!isNode(node)) return '';
  switch (node.type) {
    case 'text':
      return applyMarks(node.text || '', node.marks);
    case 'hardBreak':
      return '\n';
    case 'mention':
      return attr(node, 'text') || `@${attr(node, 'id')}`;
    case 'emoji':
      return attr(node, 'text') || attr(node, 'shortName');
    case 'date':
      return attr(node, 'timestamp');
    case 'inlineCard':
    case 'blockCard':
    case 'embedCard':
      return attr(node, 'url');
    default:
      return inline(node.content);
  }
}

/** Prefix every line of a block, so nested content stays inside its parent. */
function indent(text: string, first: string, rest = ' '.repeat(first.length)): string {
  const lines = text.split('\n');
  return lines.map((line, i) => `${i === 0 ? first : rest}${line}`.trimEnd()).join('\n');
}

function listBlock(node: AdfNode, ordered: boolean): string {
  const start = Number(attr(node, 'order')) || 1;
  return (node.content || [])
    .map((item, i) => indent(blocks(item.content), ordered ? `${start + i}. ` : '- '))
    .filter(Boolean)
    .join('\n');
}

function tableRow(row: AdfNode): string {
  const cells = (row.content || []).map((cell) => blocks(cell.content).replace(/\n+/g, ' ').trim());
  return `| ${cells.join(' | ')} |`;
}

function block(node: AdfNode): string {
  if (!isNode(node)) return '';
  switch (node.type) {
    case 'doc':
      return blocks(node.content);
    case 'paragraph':
      return inline(node.content);
    case 'heading': {
      const level = Math.min(Math.max(Number(attr(node, 'level')) || 1, 1), 6);
      const text = inline(node.content);
      return text ? `${'#'.repeat(level)} ${text}` : '';
    }
    case 'bulletList':
      return listBlock(node, false);
    case 'orderedList':
      return listBlock(node, true);
    case 'listItem':
      return blocks(node.content);
    case 'codeBlock':
      return `\`\`\`${attr(node, 'language')}\n${inline(node.content)}\n\`\`\``;
    case 'blockquote':
      return indent(blocks(node.content), '> ', '> ');
    case 'panel': {
      const kind = attr(node, 'panelType');
      const body = blocks(node.content);
      return indent(body, `> ${kind ? `**${kind}:** ` : ''}`, '> ');
    }
    case 'rule':
      return '---';
    case 'table': {
      const rows = (node.content || []).filter(isNode).map(tableRow);
      if (rows.length === 0) return '';
      const width = (node.content?.[0]?.content || []).length;
      // Markdown needs the separator directly under the header row.
      return [rows[0], `|${' --- |'.repeat(Math.max(width, 1))}`, ...rows.slice(1)].join('\n');
    }
    case 'mediaSingle':
    case 'mediaGroup':
    case 'media':
      return '';
    default:
      return node.content ? blocks(node.content) : inlineNode(node);
  }
}

function blocks(nodes: AdfNode[] | undefined): string {
  return (nodes || [])
    .map(block)
    .filter((text) => text.trim() !== '')
    .join('\n\n');
}

/**
 * Flatten an ADF document. Accepts the plain strings older Jira fields still
 * return, and anything unparseable comes back empty rather than as `[object
 * Object]` in the middle of a prompt.
 */
export function adfToMarkdown(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!isNode(value)) return '';
  return blocks(value.type === 'doc' ? value.content : [value]).trim();
}
