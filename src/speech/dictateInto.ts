import { insertDictation } from '../../shared/composer/dictation';

/**
 * Write a dictated clip into a plain controlled textarea at its caret, then
 * give focus back with the caret after the new words — the same thing the
 * composer does through `usePromptField.place`, for boxes that have no field.
 */
export function dictateInto(
  node: HTMLTextAreaElement | null,
  value: string,
  onChange: (value: string) => void,
  clip: string
): void {
  const start = node?.selectionStart ?? value.length;
  const end = node?.selectionEnd ?? value.length;
  const next = insertDictation(value, start, end, clip);
  onChange(next.text);
  requestAnimationFrame(() => {
    if (!node) return;
    node.focus();
    node.setSelectionRange(next.cursor, next.cursor);
  });
}
