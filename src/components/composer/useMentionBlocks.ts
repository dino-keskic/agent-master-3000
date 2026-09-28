import { useRef, useState } from 'react';
import {
  MentionAttachment,
  MentionExtra,
  MentionItem,
  extraKey,
  extrasForKind
} from '../../../shared/trackers/mentions';
import { api } from '../../api';

/**
 * The blocks themselves: fetched, held beside the box, and handed over on send.
 *
 * Nothing here is written into the textarea. `attached` is the render-visible
 * half; `blocks` is what the send actually reads, so a block that lands
 * mid-keystroke cannot be lost to a stale closure.
 */

export interface MentionBlocks {
  /** Keys of the blocks that will be folded into the prompt on send. */
  attached: Set<string>;
  /** Keys still being fetched. */
  pending: Set<string>;
  error?: string;
  clearError: () => void;
  /** Fetch one block, or join the fetch already in flight for it. */
  fetch: (item: MentionItem, extra: MentionExtra) => void;
  /** Add or drop one block. */
  toggle: (item: MentionItem, extra: MentionExtra) => void;
  /** Every held block for these items, once what is in flight has landed. */
  collect: (items: MentionItem[]) => Promise<MentionAttachment[]>;
}

export function useMentionBlocks(): MentionBlocks {
  const blocks = useRef(new Map<string, MentionAttachment>());
  const fetches = useRef(new Map<string, Promise<MentionAttachment | null>>());
  const [attached, setAttached] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | undefined>();

  const drop = (set: Set<string>, key: string) => {
    const next = new Set(set);
    next.delete(key);
    return next;
  };

  const fetchExtra = (item: MentionItem, extra: MentionExtra): Promise<MentionAttachment | null> => {
    const key = extraKey(item, extra);
    const held = blocks.current.get(key);
    if (held) return Promise.resolve(held);
    const inFlight = fetches.current.get(key);
    if (inFlight) return inFlight;

    setPending((prev) => new Set(prev).add(key));
    const run = api.mentionContext(item, extra)
      .then((result) => {
        if (result.error) setError(result.error);
        if (!result.body) return null;
        const attachment: MentionAttachment = { item, extra, body: result.body };
        blocks.current.set(key, attachment);
        setAttached((prev) => new Set(prev).add(key));
        return attachment;
      })
      .catch(() => {
        setError(`Could not load the ${extra} for ${item.id}`);
        return null;
      })
      .finally(() => {
        fetches.current.delete(key);
        setPending((prev) => drop(prev, key));
      });
    fetches.current.set(key, run);
    return run;
  };

  return {
    attached,
    pending,
    error,
    clearError: () => setError(undefined),

    fetch(item, extra) {
      void fetchExtra(item, extra);
    },

    toggle(item, extra) {
      const key = extraKey(item, extra);
      if (blocks.current.has(key)) {
        blocks.current.delete(key);
        setAttached((prev) => drop(prev, key));
        return;
      }
      if (pending.has(key)) return;
      setError(undefined);
      void fetchExtra(item, extra);
    },

    /**
     * A block still in flight is waited for rather than dropped: the point of
     * fetching the description on the pick is that it goes with the turn.
     */
    async collect(items) {
      if (fetches.current.size > 0) await Promise.allSettled([...fetches.current.values()]);
      return items.flatMap((item) =>
        extrasForKind(item.kind)
          .map((extra) => blocks.current.get(extraKey(item, extra.id)))
          .filter((attachment): attachment is MentionAttachment => !!attachment)
      );
    }
  };
}
