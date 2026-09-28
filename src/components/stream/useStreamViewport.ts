import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { TaskLogItem } from '../../../shared/types';

/**
 * Keeping a long, live transcript readable: how much of it is on screen, where
 * it is scrolled, and which React key each entry keeps while it streams.
 */

const PAGE = 50;

export interface StreamViewport {
  viewportRef: React.RefObject<HTMLDivElement>;
  /** The tail of the log that is currently rendered. */
  visible: TaskLogItem[];
  /** Index of the first visible entry, so a row knows if it is the last one. */
  start: number;
  /** How many entries are paginated out behind "Show earlier". */
  hidden: number;
  /** One key per visible entry, stable across the deltas of a streaming turn. */
  keys: string[];
  onScrollPositionChange: (position: { x: number; y: number }) => void;
  showEarlier: () => void;
  jumpToMessage: (log: TaskLogItem) => void;
  pageSize: number;
}

function logFingerprints(log: TaskLogItem): string[] {
  const out = [`id:${log.id}`];
  if (log.toolCall?.toolCallId) out.push(`tool:${log.toolCall.toolCallId}`);
  if (log.type === 'user_say' || log.type === 'agent_say' || log.type === 'thought') {
    const slice = (log.text || '').slice(0, 64);
    if (slice.length >= 32) out.push(`t:${log.type}:${slice}`);
  }
  return out;
}

/**
 * `follow` changes when the user sends something: the view jumps back to the
 * bottom and stays pinned there, even if they had scrolled up to read.
 */
export function useStreamViewport(logs: TaskLogItem[], follow?: string): StreamViewport {
  const [visibleCount, setVisibleCount] = useState(PAGE);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);
  const keyByFingerprint = useRef(new Map<string, string>());

  const start = Math.max(0, logs.length - visibleCount);
  const visible = logs.slice(start);
  const last = logs[logs.length - 1];
  const lastSig = last ? `${last.id}:${last.text?.length ?? 0}:${last.toolCall?.status ?? ''}` : '';

  /**
   * Stable React keys across a streaming turn. A log's `id` can change between
   * deltas while the entry on screen is the same one, so a key derived from the
   * id alone remounts the node mid-stream and loses its scroll position and
   * selection. The fingerprint map remembers which key an entry was already
   * given.
   *
   * This reads and writes a ref during render, which the rule rightly flags.
   * It is safe here because the pass is idempotent: a re-render over the same
   * logs finds the same fingerprints already mapped to the same keys and
   * assigns nothing new, so a double render (StrictMode, or a concurrent
   * re-render that is thrown away) produces identical output.
   */
  /* eslint-disable react-hooks/refs */
  const keys = (() => {
    const used = new Set<string>();
    return visible.map((log) => {
      const fingerprints = logFingerprints(log);
      let key: string | undefined;
      for (const fp of fingerprints) {
        const existing = keyByFingerprint.current.get(fp);
        if (existing && !used.has(existing)) {
          key = existing;
          break;
        }
      }
      if (!key || used.has(key)) key = log.id;
      if (used.has(key)) key = `${log.id}:${log.timestamp}`;
      used.add(key);
      for (const fp of fingerprints) keyByFingerprint.current.set(fp, key);
      return key;
    });
  })();
  /* eslint-enable react-hooks/refs */

  const onScrollPositionChange = useCallback(({ y }: { x: number; y: number }) => {
    const el = viewportRef.current;
    if (!el) return;
    pinnedToBottom.current = el.scrollHeight - y - el.clientHeight < 96;
  }, []);

  const followed = useRef(follow);
  useLayoutEffect(() => {
    if (follow && follow !== followed.current) pinnedToBottom.current = true;
    followed.current = follow;
    if (!pinnedToBottom.current) return;
    const el = viewportRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lastSig, visibleCount, follow]);

  return {
    viewportRef,
    visible,
    start,
    hidden: start,
    keys,
    onScrollPositionChange,
    showEarlier() {
      const el = viewportRef.current;
      const prevHeight = el?.scrollHeight ?? 0;
      pinnedToBottom.current = false;
      setVisibleCount((count) => count + PAGE);
      requestAnimationFrame(() => {
        if (!el) return;
        el.scrollTop += el.scrollHeight - prevHeight;
      });
    },
    /**
     * A message can be paginated out behind "Show earlier". Revealing everything
     * on jump is simpler and more honest than guessing how many pages are needed,
     * and it is an explicit action the user chose rather than something automatic.
     */
    jumpToMessage(log) {
      const index = logs.findIndex((entry) => entry.id === log.id);
      pinnedToBottom.current = false;
      if (index >= 0 && index < start) setVisibleCount(logs.length);

      // Two frames: one for the state update to commit and paint if the message
      // was hidden, one margin of safety for the scroll container to settle.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = document.getElementById(`log-${log.id}`);
          if (!el) return;
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          el.classList.add('ring-2', 'ring-accent');
          setTimeout(() => el.classList.remove('ring-2', 'ring-accent'), 1200);
        });
      });
    },
    pageSize: PAGE
  };
}
