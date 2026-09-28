import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { MdBlock, MdInline, parseInline, parseMarkdown } from '../../../shared/transcript/markdown';
import { highlight } from '../../../shared/transcript/highlight';
import { parseFileToken, parseFileUrl, splitFileLinks } from '../../../shared/transcript/fileLinks';
import { FileLink, useFileLinks } from './FileLinks';
import { HighlightedCode } from './HighlightedCode';

/**
 * Renders agent output.
 *
 * The parse is in `shared/transcript/markdown.ts`; this file only turns its tree into
 * React nodes. Nothing here builds markup from a string — no
 * `dangerouslySetInnerHTML` anywhere — so model output stays data and cannot
 * inject anything into the page.
 *
 * File references become editor links everywhere except inside fenced code,
 * which is shown as literal content. Inline code is *not* exempt: backticked
 * paths are how agents cite files most often.
 *
 * Presentation lives in `src/index.css` under `.md`, so the whole document's
 * rhythm can be read in one place instead of being spread across the tree walk.
 */

/** Off (no links rendered at all) until an editor is known to exist. */
interface LinkOptions {
  enabled: boolean;
  cwd?: string;
  /**
   * False inside something that is itself a click target — a card is one big
   * link — where an anchor would steal the click. Links read as their text.
   */
  anchors?: boolean;
}

/** Plain prose, with any file reference in it lifted out as a link. */
function renderText(text: string, key: string, links: LinkOptions): React.ReactNode {
  if (!links.enabled) return <React.Fragment key={key}>{text}</React.Fragment>;
  const parts = splitFileLinks(text, links.cwd);
  if (!parts.some((part) => part.kind === 'file')) {
    return <React.Fragment key={key}>{text}</React.Fragment>;
  }
  return (
    <React.Fragment key={key}>
      {parts.map((part, index) =>
        part.kind === 'file' ? (
          <FileLink key={index} target={part.ref} label={part.text} />
        ) : (
          <React.Fragment key={index}>{part.text}</React.Fragment>
        )
      )}
    </React.Fragment>
  );
}

function renderInline(nodes: MdInline[], keyPrefix: string, links: LinkOptions): React.ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (node.kind) {
      case 'text':
        return renderText(node.text, key, links);

      case 'code': {
        const ref = links.enabled ? parseFileToken(node.text, links.cwd) : null;
        if (ref) return <FileLink key={key} target={ref} label={node.text} mono />;
        return <code key={key}>{node.text}</code>;
      }

      case 'strong':
        return <strong key={key}>{renderInline(node.children, key, links)}</strong>;

      case 'em':
        return <em key={key}>{renderInline(node.children, key, links)}</em>;

      case 'strike':
        return <s key={key} className="opacity-70">{renderInline(node.children, key, links)}</s>;

      case 'link': {
        if (links.anchors === false) {
          return <React.Fragment key={key}>{renderInline(node.children, key, links)}</React.Fragment>;
        }
        if (/^file:\/\//i.test(node.href)) {
          const ref = links.enabled ? parseFileUrl(node.href) : null;
          const label = plainText(node.children);
          // A dead file:// anchor is worse than plain text, so drop the link
          // when there is no editor to hand it to.
          return ref
            ? <FileLink key={key} target={ref} label={label} />
            : <React.Fragment key={key}>{label}</React.Fragment>;
        }
        // Anything that is not http(s) — `javascript:`, `data:` — is not a
        // destination this app will hand a click to.
        if (!/^https?:\/\//i.test(node.href)) {
          return <React.Fragment key={key}>{renderInline(node.children, key, links)}</React.Fragment>;
        }
        return (
          <a key={key} href={node.href} target="_blank" rel="noreferrer noopener">
            {renderInline(node.children, key, links)}
          </a>
        );
      }
    }
  });
}

function plainText(nodes: MdInline[]): string {
  return nodes
    .map((node) => (node.kind === 'text' || node.kind === 'code' ? node.text : plainText('children' in node ? node.children : [])))
    .join('');
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const tokens = highlight(code, lang);
  const lines = code === '' ? 0 : code.split('\n').length;

  const copy = () => {
    // Typed as always present, but absent on insecure origins.
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (!clipboard) return;
    void clipboard.writeText(code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      },
      () => { /* a denied clipboard is not worth a notification */ }
    );
  };

  return (
    <div className="md-code">
      <div className="md-code-head">
        <span className="font-mono">{lang || 'text'}</span>
        <span className="flex items-center gap-2.5">
          <span className="font-mono normal-case tracking-normal">{lines} ln</span>
          <button
            type="button"
            onClick={copy}
            title="Copy"
            aria-label={copied ? 'Copied' : 'Copy code'}
            className="flex items-center gap-1 text-ink-4 hover:text-ink-2 transition-colors"
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          </button>
        </span>
      </div>
      <pre>
        <code>
          <HighlightedCode tokens={tokens} />
        </code>
      </pre>
    </div>
  );
}

function renderBlocks(blocks: MdBlock[], keyPrefix: string, links: LinkOptions): React.ReactNode[] {
  return blocks.map((block, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (block.kind) {
      case 'paragraph':
        return <p key={key}>{renderInline(parseInline(block.text), key, links)}</p>;

      case 'heading': {
        const Tag = (`h${Math.min(block.level, 4)}`) as 'h1' | 'h2' | 'h3' | 'h4';
        return <Tag key={key}>{renderInline(parseInline(block.text), key, links)}</Tag>;
      }

      case 'code':
        return <CodeBlock key={key} code={block.code} lang={block.lang} />;

      case 'rule':
        return <hr key={key} />;

      case 'quote':
        return <blockquote key={key}>{renderBlocks(block.blocks, key, links)}</blockquote>;

      case 'list': {
        const isTaskList = block.items.some((item) => item.checked !== undefined);
        const Tag = block.ordered ? 'ol' : 'ul';
        return (
          <Tag
            key={key}
            className={isTaskList ? 'md-task-list' : undefined}
            data-tight={block.tight ? 'true' : undefined}
            start={block.ordered && block.start !== 1 ? block.start : undefined}
          >
            {block.items.map((item, itemIndex) => {
              const itemKey = `${key}-i${itemIndex}`;
              const body = renderBlocks(item.blocks, itemKey, links);
              if (item.checked === undefined) return <li key={itemKey}>{body}</li>;
              return (
                <li key={itemKey} className="md-task">
                  <span className="md-task-box" data-checked={item.checked} aria-hidden="true" />
                  <span className={item.checked ? 'opacity-65 min-w-0' : 'min-w-0'}>{body}</span>
                </li>
              );
            })}
          </Tag>
        );
      }

      case 'table':
        return (
          <div key={key} className="md-table-scroll">
            <table>
              <thead>
                <tr>
                  {block.head.map((cell, cellIndex) => (
                    <th key={cellIndex} data-align={block.align[cellIndex] ?? undefined}>
                      {renderInline(parseInline(cell), `${key}-h${cellIndex}`, links)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} data-align={block.align[cellIndex] ?? undefined}>
                        {renderInline(parseInline(cell), `${key}-r${rowIndex}c${cellIndex}`, links)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  });
}

export const Markdown: React.FC<{ children: string; className?: string }> = ({ children, className }) => {
  const { cwd, editorId } = useFileLinks();
  const links: LinkOptions = { enabled: !!editorId, cwd };
  const blocks = parseMarkdown(children || '');

  return <div className={`md ${className || ''}`}>{renderBlocks(blocks, 'md', links)}</div>;
};

/**
 * One line of inline markdown — bold, code, emphasis — for a preview that has
 * already been flattened by `shared/transcript/markdownPreview.ts`. No file links and no
 * anchors: it sits inside a card whose whole face is the click. Styled under
 * `.md-inline` in `src/index.css`.
 */
export const InlineMarkdown: React.FC<{ text: string }> = ({ text }) => (
  <span className="md-inline">{renderInline(parseInline(text), 'mi', { enabled: false, anchors: false })}</span>
);
