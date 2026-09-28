import { useMemo, useState } from 'react';
import { SlashCommand, dedupeSlashCommands, sortSlashCommands } from '../../../shared/composer/slashCommands';
import { composerTrigger } from '../../../shared/composer/triggers';
import {
  ComposerMenuEntry,
  applyMenuEntry,
  composerMenuEntries,
  composerMenuHint,
  moveMenuActive
} from '../../../shared/composer/menu';
import { useMenuLookups } from './useMenuLookups';

/**
 * The `/` and `@` menu: what is open, what is in it, and which row is next.
 *
 * Everything that decides what a row *is* lives in `shared/composer/menu`, and
 * the reads that fill it in `useMenuLookups`; what is here is where the user is
 * in the list.
 */

export interface ComposerMenu {
  open: boolean;
  entries: ComposerMenuEntry[];
  active: number;
  setActive: (index: number) => void;
  /** Arrow keys, wrapping at both ends. */
  moveBy: (delta: number) => void;
  loading: boolean;
  error?: string;
  emptyHint: string;
  /** Close the menu for this trigger; typing on opens it again. */
  dismiss: () => void;
  /** Reopen after a pick wrote something in. */
  reset: () => void;
  /** What picking a row writes, or null when the row inserts nothing. */
  apply: (entry: ComposerMenuEntry) => { text: string; cursor: number } | null;
}

export function useComposerMenu(
  value: string,
  cursor: number,
  cwd: string | undefined,
  slashCommands: SlashCommand[] | undefined
): ComposerMenu {
  // The highlighted row is remembered against the token it was chosen in, so
  // typing one more character starts back at the top without an effect to
  // reset it.
  const [highlight, setHighlight] = useState({ token: '', index: 0 });
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  const hit = composerTrigger(value, cursor);
  const trigger = hit?.trigger;
  const start = trigger?.start;
  const open = !!trigger && start !== dismissedAt;
  const query = trigger?.query || '';
  const kind = hit?.kind;
  const token = `${kind || ''}:${query}`;
  const active = highlight.token === token ? highlight.index : 0;

  // A dismissal belongs to the token it was made in. Once the caret has left
  // that token there is nothing to keep closed, and a later `@` at the same
  // offset has to be able to open.
  if (!trigger && dismissedAt !== null) setDismissedAt(null);

  const lookups = useMenuLookups(open && kind === 'at', query, cwd);

  const commandPool = useMemo(
    () => sortSlashCommands(dedupeSlashCommands([...(slashCommands || []), ...lookups.agentCommands])),
    [slashCommands, lookups.agentCommands]
  );

  const entries = useMemo<ComposerMenuEntry[]>(
    () =>
      open && kind
        ? composerMenuEntries({ kind, query, commands: commandPool, files: lookups.files, mentions: lookups.mentions })
        : [],
    [open, kind, query, commandPool, lookups.files, lookups.mentions]
  );

  return {
    open,
    entries,
    active,
    setActive: (index) => setHighlight({ token, index }),
    moveBy: (delta) => setHighlight({ token, index: moveMenuActive(active, entries.length, delta) }),
    loading: lookups.loading,
    // An error from a lookup for a token the caret has since left is history.
    error: open && kind === 'at' ? lookups.error : undefined,
    emptyHint: composerMenuHint(kind || 'at', !!cwd),
    dismiss: () => setDismissedAt(start ?? null),
    reset: () => setDismissedAt(null),
    apply: (entry) => (trigger ? applyMenuEntry(entry, value, trigger, cursor) : null)
  };
}
