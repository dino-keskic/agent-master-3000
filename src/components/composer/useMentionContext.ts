import React, { useMemo, useState } from 'react';
import {
  MentionExtra,
  MentionItem,
  composeMentionPrompt,
  linkifyMentionUrls,
  mentionInText,
  mentionLink,
  mentionRef,
  swapMentionLink
} from '../../../shared/trackers/mentions';
import { api } from '../../api';
import { PromptField } from './usePromptField';
import { useMentionBlocks } from './useMentionBlocks';

/**
 * The context riding along with a ticket or PR in the prompt.
 *
 * A linked item puts one Markdown link in the box and nothing else; its
 * description, comments and CI checks are fetched and held out here, then
 * folded in when the turn is sent. That is the whole reason this is a hook
 * rather than text in the textarea: pasting a ticket body into the box buried
 * whatever sentence the user was in the middle of writing.
 *
 * This half tracks *which* tickets and PRs are in play. The blocks they carry
 * are `useMentionBlocks`.
 */

/**
 * How many pasted links are looked up. Someone dropping a wall of URLs in at
 * once wants the text, not twenty CLI calls; the ones past the cap stay as
 * plain ref links, the same state a lookup that fails leaves behind.
 */
const PASTE_RESOLVE_LIMIT = 8;

export interface MentionContext {
  /** Tickets and PRs whose link is still somewhere in the prompt. */
  linked: MentionItem[];
  /** Keys of the blocks that will be folded into the prompt on send. */
  attached: Set<string>;
  /** Keys still being fetched. */
  pending: Set<string>;
  error?: string;
  /** A ticket or PR the user picked from the menu. */
  pick: (item: MentionItem) => void;
  /** Add or drop one block. */
  toggle: (item: MentionItem, extra: MentionExtra) => void;
  /** Take on pasted tracker links. False when the paste was ordinary text. */
  paste: (event: React.ClipboardEvent<HTMLTextAreaElement>, value: string) => boolean;
  /** The prompt as the agent will see it, once everything in flight has landed. */
  buildPrompt: (text: string) => Promise<string>;
}

export function useMentionContext(value: string, field: PromptField): MentionContext {
  const [picked, setPicked] = useState<MentionItem[]>([]);
  const blocks = useMentionBlocks();

  const remember = (item: MentionItem) =>
    setPicked((prev) => (prev.some((p) => mentionRef(p) === mentionRef(item)) ? prev : [...prev, item]));

  /**
   * Take on a ticket or PR the user pasted rather than picked. The link is
   * already in the box reading as its ref; this goes and gets the title, swaps
   * it into the link text, and pulls the description across the way a picked
   * one does. If the lookup fails the ref link stands on its own, so nothing
   * here is allowed to undo the paste.
   */
  const adopt = async (item: MentionItem) => {
    remember(item);
    const resolved = await api.resolveMention(item).then((r) => r.item).catch(() => undefined);
    if (resolved) {
      setPicked((prev) => prev.map((p) => (mentionRef(p) === mentionRef(item) ? resolved : p)));
      const swap = swapMentionLink(field.latest(), field.caret(), mentionLink(item), mentionLink(resolved));
      if (swap) field.place(swap);
    }
    blocks.fetch(resolved || item, 'description');
  };

  return {
    linked: useMemo(() => picked.filter((item) => mentionInText(value, item)), [picked, value]),
    attached: blocks.attached,
    pending: blocks.pending,
    error: blocks.error,
    toggle: blocks.toggle,

    pick(item) {
      remember(item);
      blocks.clearError();
      // The description is the part you always meant to send, so it is fetched
      // on the pick; comments and CI checks stay buttons, since they mostly are not.
      blocks.fetch(item, 'description');
    },

    /**
     * A pasted ticket or PR link means what a picked one means, so it is
     * treated the same: written in as a Markdown link and looked up. Anything
     * else — and that is most pastes — falls through to the browser untouched.
     */
    paste(event, text) {
      const pasted = event.clipboardData.getData('text/plain');
      if (!pasted) return false;
      const found = linkifyMentionUrls(pasted);
      if (found.items.length === 0) return false;
      event.preventDefault();
      const el = event.currentTarget;
      const from = el.selectionStart;
      const to = el.selectionEnd;
      field.place({
        text: `${text.slice(0, from)}${found.text}${text.slice(to)}`,
        cursor: from + found.text.length
      });
      blocks.clearError();
      for (const item of found.items.slice(0, PASTE_RESOLVE_LIMIT)) void adopt(item);
      return true;
    },

    /** Hand the parent the prompt the agent will actually see. */
    async buildPrompt(text) {
      const inPrompt = picked.filter((item) => mentionInText(text, item));
      return composeMentionPrompt(text, await blocks.collect(inPrompt));
    }
  };
}
