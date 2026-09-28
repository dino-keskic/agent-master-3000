import React from 'react';
import { Group, Loader, Text } from '@mantine/core';
import { Check, GitPullRequest, Plus, Ticket } from 'lucide-react';
import { MentionExtra, MentionItem, extraKey, extrasForKind, mentionRef } from '../../../shared/trackers/mentions';

interface MentionContextBarProps {
  /** The tickets and PRs still linked in the prompt. */
  items: MentionItem[];
  /** Keys of the blocks that will be folded into the prompt on send. */
  attached: Set<string>;
  /** Keys still being fetched. */
  pending: Set<string>;
  onToggle: (item: MentionItem, extra: MentionExtra) => void;
}

/**
 * What each linked ticket or PR is sending with the turn, and what else it
 * could. The description arrives on the pick; comment threads and CI output are
 * things you sometimes want and mostly do not, so they wait behind a button.
 *
 * None of it is ever written into the textarea — that keeps the link, which is
 * the whole point. These chips are how you see what is riding along with it.
 */
export const MentionContextBar: React.FC<MentionContextBarProps> = ({
  items,
  attached,
  pending,
  onToggle
}) => {
  if (items.length === 0) return null;

  return (
    <Group gap={6} wrap="wrap" align="center" className="px-0.5">
      {items.map((item) => (
        <Group key={mentionRef(item)} gap={4} wrap="nowrap" className="min-w-0">
          {item.kind === 'jira' ? (
            <Ticket className="w-3 h-3 text-accent shrink-0" />
          ) : (
            <GitPullRequest className="w-3 h-3 text-teal-300 shrink-0" />
          )}
          <Text size="10px" className="font-mono text-slate-300 shrink-0" title={item.title}>
            {item.id}
          </Text>
          {extrasForKind(item.kind).map((extra) => {
            const key = extraKey(item, extra.id);
            const on = attached.has(key);
            const busy = pending.has(key);
            return (
              <button
                key={extra.id}
                type="button"
                aria-pressed={on}
                disabled={busy}
                title={
                  on
                    ? `Do not send the ${extra.label} with this turn`
                    : `Fetch the ${extra.label} and send it with this turn`
                }
                onClick={() => onToggle(item, extra.id)}
                className={`flex items-center gap-1 rounded-full border px-1.5 py-[1px] text-[10px] font-mono transition-colors ${
                  on
                    ? 'border-accent/70 bg-acc-bg text-ink'
                    : 'border-line bg-canvas/40 text-ink-3 hover:border-line-strong hover:text-slate-300'
                }`}
              >
                {busy ? (
                  <Loader size={8} color="gray" />
                ) : on ? (
                  <Check className="w-2.5 h-2.5" />
                ) : (
                  <Plus className="w-2.5 h-2.5" />
                )}
                {extra.label}
              </button>
            );
          })}
        </Group>
      ))}
    </Group>
  );
};
