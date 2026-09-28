/**
 * The decisions behind the composer's inline pickers: which options a search
 * leaves, and what the closed picker says.
 *
 * The pickers themselves (`src/components/ui/InlineSelect.tsx`) only arrange
 * these; anything that decides what is shown lives here, where it is tested.
 */

export interface InlineOption {
  value: string;
  label: string;
  /** Extra text a search should match but the row need not show, e.g. a path. */
  keywords?: string;
}

/**
 * The options a search leaves, in their original order.
 *
 * Every word of the query must appear somewhere in the label or keywords, so
 * "son 4" finds "claude-sonnet-4" and "feat login" finds a worktree whose
 * folder is `feat` on branch `login-fix`. An empty query returns the same
 * array, so a memo keyed on it does not churn while the box is empty.
 */
export function filterInlineOptions<T extends InlineOption>(options: T[], query: string): T[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return options;
  return options.filter((option) => {
    const haystack = `${option.label} ${option.keywords || ''}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

export interface InlineTriggerText {
  text: string;
  /** False when the value is not one of the options: the text is a stand-in. */
  known: boolean;
}

/**
 * What the closed picker reads.
 *
 * A value the list no longer has (an agent removed from the catalog, a model
 * that was renamed) keeps its own name with "(unavailable)", rather than the
 * picker going blank and looking unset. Nothing chosen at all is the
 * placeholder.
 */
export function inlineTriggerText(options: InlineOption[], value: string | null | undefined, placeholder: string): InlineTriggerText {
  if (!value) return { text: placeholder, known: false };
  const match = options.find((option) => option.value === value);
  if (match) return { text: match.label, known: true };
  return { text: `${value} (unavailable)`, known: false };
}
