import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * The textarea itself: where the caret is, how tall the box is, and how text
 * gets written into it from somewhere other than typing.
 *
 * The value is the parent's — the composer is controlled — so what is held
 * here is only what the DOM node knows and React does not.
 */

/** How tall the box may grow before it scrolls instead. */
const MAX_HEIGHT_PX = 160;

export interface PromptField {
  /** Callback ref for the textarea node. */
  attach: (node: HTMLTextAreaElement | null) => void;
  cursor: number;
  /** Track the caret after anything that can move it. */
  syncCursor: (el: HTMLTextAreaElement) => void;
  /** Where the caret is right now, straight off the node. */
  caret: () => number;
  /** The selected range, `[start, end]`, equal when nothing is selected. */
  selection: () => [number, number];
  /**
   * The value as the DOM has it. Read by work that lands after the user has
   * typed on, when `value` in that closure is already a render behind.
   */
  latest: () => string;
  /** Write text in and put the caret somewhere, keeping focus. */
  place: (next: { text: string; cursor: number }) => void;
}

export function usePromptField(
  value: string,
  onChange: (value: string) => void,
  externalRef?: React.MutableRefObject<HTMLTextAreaElement | null>
): PromptField {
  const nodeRef = useRef<HTMLTextAreaElement | null>(null);
  const [cursor, setCursor] = useState(0);
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const attach = useCallback((el: HTMLTextAreaElement | null) => {
    nodeRef.current = el;
    if (externalRef) externalRef.current = el;
  }, [externalRef]);

  useLayoutEffect(() => {
    const el = nodeRef.current;
    if (!el) return;
    // An empty box is left to the stylesheet's `min-height`. Measuring it here
    // would pin an inline height taken before the styles had landed, which in
    // dev is a whole stylesheet late and leaves the box stuck at its cap.
    if (!value) {
      el.style.height = '';
      return;
    }
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value]);

  const place = useCallback((next: { text: string; cursor: number }) => {
    onChange(next.text);
    valueRef.current = next.text;
    requestAnimationFrame(() => {
      const el = nodeRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.cursor, next.cursor);
      setCursor(next.cursor);
    });
  }, [onChange]);

  return {
    attach,
    cursor,
    syncCursor: (el) => setCursor(el.selectionStart),
    caret: () => nodeRef.current?.selectionStart ?? valueRef.current.length,
    selection: () => {
      const el = nodeRef.current;
      const end = valueRef.current.length;
      return el ? [el.selectionStart, el.selectionEnd] : [end, end];
    },
    latest: () => valueRef.current,
    place
  };
}
