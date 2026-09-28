import React from 'react';
import { Loader, Tooltip } from '@mantine/core';
import { TaskSpendBreakdown } from '../../../shared/spend/types';
import { ContextTone, contextTone, formatCompactCount, formatUsd, formatUsdExact } from '../../../shared/sessions/cost';
import { SectionLabel } from './SectionLabel';
import { SpendBreakdown } from './SpendBreakdown';

/**
 * What the work has cost, and how much room the session on screen has left.
 *
 * One card at the top answers the two questions people open the sidebar for,
 * in figures big enough to read: this session, and the task. A task with one
 * session shows one figure — two tiles printing the same money reads as a bug.
 * The session's cost is the whole tree, subagents included: nobody dispatches
 * six of them and then wants the parent turn alone.
 *
 * Below the card, the task's total split by stage, model or agent. A session
 * that has reported none of this renders no section at all.
 */

const FILL: Record<ContextTone, string> = { ok: 'bg-accent', warn: 'bg-wait', full: 'bg-err' };

interface UsageSectionProps {
  /** The session on screen, subagents included. */
  sessionCost?: number;
  /** More than one session, so the session's figure and the task's differ. */
  multiSession: boolean;
  subagentCount?: number;
  contextPct?: number;
  contextLabel?: string;
  breakdown: TaskSpendBreakdown | null;
  loading: boolean;
}

const Tile: React.FC<{ label: string; value?: string; caption?: string; tip?: string; busy?: boolean }> = ({
  label,
  value,
  caption,
  tip,
  busy
}) => {
  const figure = (
    <span className="font-mono text-[18px] font-semibold leading-6 tabular-nums text-ink">{value || '—'}</span>
  );
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
      <span className="type-meta text-ink-3">{label}</span>
      {busy && !value ? (
        <span className="flex h-6 items-center">
          <Loader size={12} color="gray" />
        </span>
      ) : tip ? (
        <Tooltip label={tip} withArrow position="left" multiline maw={240}>
          {figure}
        </Tooltip>
      ) : (
        figure
      )}
      {caption && <span className="type-meta truncate text-ink-4">{caption}</span>}
    </div>
  );
};

export const UsageSection: React.FC<UsageSectionProps> = ({
  sessionCost,
  multiSession,
  subagentCount,
  contextPct,
  contextLabel,
  breakdown,
  loading
}) => {
  const total = breakdown && breakdown.total > 0 ? breakdown.total : undefined;
  const tokens = formatCompactCount(breakdown?.tokens);
  const subagents = subagentCount ? `incl. ${subagentCount} subagent${subagentCount === 1 ? '' : 's'}` : undefined;
  if (!sessionCost && !total && !contextLabel && !loading && !breakdown?.error) return null;

  const tone = contextTone(contextPct);

  return (
    <div className="flex flex-col gap-3">
      <SectionLabel>Usage</SectionLabel>

      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className={`grid ${multiSession ? 'grid-cols-2 divide-x divide-line' : 'grid-cols-1'}`}>
          {multiSession && (
            <Tile
              label="This session"
              value={formatUsd(sessionCost)}
              caption={subagents}
              tip="Everything this session spent, subagents included."
            />
          )}
          <Tile
            label={multiSession ? 'Task total' : 'Spent'}
            // Cents, like the rows below, which are rounded to add up to it.
            value={formatUsdExact(total) || formatUsd(sessionCost)}
            caption={[tokens && `${tokens} tokens`, !multiSession && subagents].filter(Boolean).join(' · ') || undefined}
            tip={tokens ? 'Tokens processed, cached input included — every turn re-reads the context it built.' : undefined}
            busy={loading}
          />
        </div>

        {contextLabel && (
          <div className="flex flex-col gap-1.5 border-t border-line px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="type-meta text-ink-3">Context</span>
              <span className="font-mono text-[11px] tabular-nums text-ink-2">
                {contextLabel}
                {contextPct != null && (
                  <span className={tone === 'ok' ? 'text-ink-4' : tone === 'warn' ? 'text-wait-fg' : 'text-err-fg'}>
                    {' · '}
                    {contextPct}%
                  </span>
                )}
              </span>
            </div>
            {contextPct != null && (
              <div className="h-1.5 overflow-hidden rounded-full bg-s4">
                <div className={`h-full rounded-full ${FILL[tone]}`} style={{ width: `${Math.max(2, contextPct)}%` }} />
              </div>
            )}
          </div>
        )}
      </div>

      {breakdown && total && <SpendBreakdown breakdown={breakdown} />}

      {breakdown?.error && <span className="type-meta text-wait-fg">{breakdown.error}</span>}
    </div>
  );
};
