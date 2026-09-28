import React, { useRef } from 'react';
import { ComposerMenuEntry } from '../../../shared/composer/menu';
import { promptHighlights } from '../../../shared/composer/promptHighlights';
import { ComposerMenu } from './useComposerMenu';
import { PromptField } from './usePromptField';

/**
 * The box you type in.
 *
 * The keyboard is the whole of it: while the menu is open the arrows, Enter
 * and Tab belong to the list, and ⌘Enter sends from anywhere. Everything else
 * — what the rows are, what picking one writes — belongs to the hooks.
 * The `/skill` a message starts with, its `@file`s and ticket links are
 * tinted from a layer behind the box, so what will be read as a skill or a
 * mention looks like one before it is sent.
 */

interface PromptTextareaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  disabled: boolean;
  /** The callback ref for the node, from `usePromptField`. */
  attachRef: (node: HTMLTextAreaElement | null) => void;
  field: PromptField;
  menu: ComposerMenu;
  onPick: (entry: ComposerMenuEntry) => void;
  /** ⌘Enter. Ignored when there is nothing to send. */
  onSend: () => void;
  onPaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
}

export const PromptTextarea: React.FC<PromptTextareaProps> = ({
  value,
  onChange,
  placeholder,
  disabled,
  attachRef,
  field,
  menu,
  onPick,
  onSend,
  onPaste
}) => {
  const backdrop = useRef<HTMLDivElement>(null);
  const pickActive = () => {
    const entry = menu.entries[menu.active] || menu.entries[0];
    if (entry) onPick(entry);
  };

  const handleMenuKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!menu.open) return false;
    if (e.key === 'Escape') {
      menu.dismiss();
      return true;
    }
    if (menu.entries.length === 0) return false;
    if (e.key === 'ArrowDown') {
      menu.moveBy(1);
      return true;
    }
    if (e.key === 'ArrowUp') {
      menu.moveBy(-1);
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      pickActive();
      return true;
    }
    return false;
  };

  return (
    <div className="relative">
      <Backdrop ref={backdrop} text={value} />
      <textarea
        ref={attachRef}
        placeholder={`${placeholder}  / for commands and skills, @ for files, tickets and PRs`}
        value={value}
        onChange={(e) => {
          onChange(e.currentTarget.value);
          field.syncCursor(e.currentTarget);
        }}
        onPaste={onPaste}
        onScroll={(e) => {
          if (backdrop.current) backdrop.current.scrollTop = e.currentTarget.scrollTop;
        }}
        onClick={(e) => field.syncCursor(e.currentTarget)}
        onKeyUp={(e) => field.syncCursor(e.currentTarget)}
        onKeyDown={(e) => {
          if (handleMenuKey(e)) {
            e.preventDefault();
            return;
          }
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            onSend();
          }
        }}
        rows={2}
        disabled={disabled}
        className="composer-input"
      />
    </div>
  );
};

/**
 * The painted layer: the same text in the same face and wrap as the textarea
 * (`.composer-backdrop`), invisible except for the marks. A textarea cannot
 * style a word, so the tint shows through from underneath while the caret and
 * selection stay native.
 */
const Backdrop = React.forwardRef<HTMLDivElement, { text: string }>(function Backdrop({ text }, ref) {
  return (
    <div ref={ref} aria-hidden className="composer-backdrop">
      {promptHighlights(text).map((segment, index) =>
        segment.kind === 'plain' ? (
          <React.Fragment key={index}>{segment.text}</React.Fragment>
        ) : (
          <mark key={index} className={`composer-mark is-${segment.kind}`}>{segment.text}</mark>
        )
      )}
      {/* A trailing newline only takes up a line once something follows it. */}
      {text.endsWith('\n') ? ' ' : null}
    </div>
  );
});
