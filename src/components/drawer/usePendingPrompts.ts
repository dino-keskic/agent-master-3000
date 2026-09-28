import { useRef, useState } from 'react';
import { PromptImage } from '../../../shared/types';
import {
  PendingObservation,
  PendingPrompt,
  pendingFor,
  pendingPrompt,
  settlePendingPrompts
} from '../../../shared/turns/pendingPrompts';

/**
 * The prompts this drawer has sent that the transcript does not show yet, so
 * a message appears the moment it is sent rather than when the agent gets to
 * it. What settles one is `shared/turns/pendingPrompts`; this only holds the list.
 */

export interface PendingPrompts {
  /** The ones to draw under the transcript on screen. */
  shown: PendingPrompt[];
  /** Draw `text` as sent. Returns an id to take it back with. */
  add: (text: string, images?: PromptImage[]) => string;
  remove: (id: string) => void;
  /** Forget everything sent to one session: it was stopped before it said anything. */
  clearSession: (sessionId: string | undefined) => void;
}

export function usePendingPrompts(observed: PendingObservation): PendingPrompts {
  const [pending, setPending] = useState<PendingPrompt[]>([]);
  const nextId = useRef(0);

  // Settled while rendering, not in an effect, so the echo and the copy it
  // replaces are never both on screen. Terminates because settling returns the
  // same array when there is nothing left to change.
  const settled = settlePendingPrompts(pending, observed);
  if (settled !== pending) setPending(settled);

  return {
    shown: pendingFor(settled, observed.sessionId),
    add(text, images) {
      nextId.current += 1;
      const prompt = pendingPrompt(String(nextId.current), text, images, observed, Date.now());
      setPending((list) => [...list, prompt]);
      return prompt.id;
    },
    remove(id) {
      setPending((list) => list.filter((prompt) => prompt.id !== id));
    },
    clearSession(sessionId) {
      setPending((list) => list.filter((prompt) => prompt.sessionId && prompt.sessionId !== sessionId));
    }
  };
}
