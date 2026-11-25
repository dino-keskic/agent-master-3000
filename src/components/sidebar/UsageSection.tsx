import React from 'react';
import { Tooltip } from '@mantine/core';
import { Clock } from 'lucide-react';
import { TaskSpendBreakdown } from '../../../shared/spend/types';
import { ContextTone, contextTone, formatCompactCount, formatUsd, formatUsdExact } from '../../../shared/sessions/cost';
import { formatDuration } from '../../../shared/sessions/duration';
import { SectionLabel } from './SectionLabel';
import { SpendBreakdown } from './SpendBreakdown';

/**
 * Quiet, compact summary of spend, active run time, and context fill for the
 * session on screen. Detailed per-stage, per-model, and per-agent breakdowns
 * open in a popover so the sidebar stays uncluttered.
 */

const PCT_BADGE: Record<ContextTone, string> = {
  ok: 'bg-s3 text-ink-2',
  warn: 'bg-wait-bg text-wait-fg',
  full: 'bg-err-bg text-err-fg'
};

interface UsageSectionProps {
  /** The session on screen, subagents included. */
  sessionCost?: number;
  /** More than one session, so the session's figure and the task's differ. */
  multiSession: boolean;
  subagentCount?: number;
  isRunning?: boolean;
  /** Elapsed ms from the latest user prompt to completion (or live while running). */
  lastTurnDurationMs?: number;
  /** Active assistant run duration (ms) for the session on screen. */
  sessionDurationMs?: number;
  /** Combined active assistant run duration (ms) across every session on the task. */
  totalDurationMs?: number;
  contextPct?: number;
  contextLabel?: string;
  breakdown: TaskSpendBreakdown | null;
  loading: boolean;
}

export const UsageSection: React.FC<UsageSectionProps> = ({
  sessionCost,
  multiSession,
  subagentCount,
  isRunning = false,
  lastTurnDurationMs,
  sessionDurationMs,
  totalDurationMs,
  contextPct,
  contextLabel,
  breakdown,
  loading
}) => {
  const total = breakdown && breakdown.total > 0 ? breakdown.total : undefined;
  const tokens = formatCompactCount(breakdown?.tokens);
  const subagents = subagentCount ? `${subagentCount} subagent${subagentCount === 1 ? '' : 's'}` : undefined;
  const lastTurnLabel = formatDuration(lastTurnDurationMs);
  const durationLabel = formatDuration(sessionDurationMs);
  const totalDurationLabel = formatDuration(totalDurationMs);
  const displayDuration = durationLabel ?? (multiSession ? totalDurationLabel : undefined);
  if (!sessionCost && !total && !lastTurnLabel && !displayDuration && !contextLabel && !loading && !breakdown?.error) return null;

  const tone = contextTone(contextPct);
  const primaryCost = multiSession ? formatUsd(sessionCost) : (formatUsdExact(total) || formatUsd(sessionCost));
  const totalLabel = multiSession ? (formatUsdExact(total) || formatUsd(sessionCost)) : undefined;
  const metaBits = [
    tokens && `${tokens} tok`,
    subagents
  ].filter(Boolean).join(' · ');
  const durationTooltip =
    multiSession && durationLabel && totalDurationLabel
      ? `Whole session ${durationLabel} · Task total ${totalDurationLabel}`
      : multiSession && totalDurationLabel
        ? `Task total run time ${totalDurationLabel}`
        : 'Whole session active run time';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <SectionLabel>Usage</SectionLabel>
        {breakdown && total ? <SpendBreakdown breakdown={breakdown} /> : null}
      </div>

      <div className="px-1 flex flex-col gap-2.5">
        {(primaryCost || loading || lastTurnLabel || displayDuration || metaBits) && (
          <div className="flex flex-col gap-1">
            {(primaryCost || loading) && (
              <div className="flex items-baseline justify-between gap-2">
                <Tooltip
                  label={multiSession ? 'Spend for the session on screen (incl. subagents)' : 'Total task spend'}
                  withArrow
                  position="left"
                >
                  <span className="text-[16px] font-semibold tracking-[-0.015em] tabular-nums text-ink">
                    {primaryCost || (loading ? '…' : '$0.00')}
                  </span>
                </Tooltip>
                {totalLabel && (
                  <Tooltip label="Total spend across every session on this task" withArrow position="left">
                    <span className="text-[11.5px] tabular-nums text-ink-3">
                      {totalLabel} total
                    </span>
                  </Tooltip>
                )}
              </div>
            )}
            {(lastTurnLabel || displayDuration) && (
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11.5px] text-ink-3 tabular-nums">
                {lastTurnLabel && (
                  <Tooltip
                    label={isRunning ? 'Elapsed since last user prompt' : 'Time from last user prompt to agent completion'}
                    withArrow
                    position="left"
                  >
                    <span className="inline-flex items-center gap-1 shrink-0">
                      <Clock className="w-3 h-3 shrink-0 text-ink-4" />
                      <span className="text-ink-4">{isRunning ? 'This turn' : 'Last prompt'}</span>
                      <span className="font-medium text-ink-2">{lastTurnLabel}</span>
                    </span>
                  </Tooltip>
                )}
                {displayDuration && (
                  <Tooltip label={durationTooltip} withArrow position="left">
                    <span className="inline-flex items-center gap-1 shrink-0">
                      {!lastTurnLabel && <Clock className="w-3 h-3 shrink-0 text-ink-4" />}
                      <span className="text-ink-4">Session</span>
                      <span className="font-medium text-ink-2">{displayDuration}</span>
                    </span>
                  </Tooltip>
                )}
              </div>
            )}
            {metaBits && (
              <div className="text-[11.5px] text-ink-4 tabular-nums truncate">
                {metaBits}
              </div>
            )}
          </div>
        )}

        {contextLabel && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-medium text-ink-3">Context</span>
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[11.5px] tabular-nums text-ink-2 truncate">
                  {contextLabel}
                </span>
                {contextPct != null && (
                  <span
                    className={`px-1.5 py-px rounded-md text-[10.5px] font-semibold tabular-nums shrink-0 ${PCT_BADGE[tone]}`}
                  >
                    {contextPct}%
                  </span>
                )}
              </div>
            </div>
            {contextPct != null && (
              <Tooltip
                label={
                  tone === 'full'
                    ? `${contextPct}% full — consider compacting`
                    : tone === 'warn'
                      ? `${contextPct}% full — approaching context limit`
                      : `${contextPct}% of context window used`
                }
                withArrow
                position="left"
              >
                <div
                  className="ctx-bar-track"
                  role="progressbar"
                  aria-label="Context window usage"
                  aria-valuenow={contextPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className={`ctx-bar-fill is-${tone}`}
                    style={{ width: `${Math.max(contextPct > 0 ? 3 : 0, Math.min(100, contextPct))}%` }}
                  />
                  <span className="ctx-bar-tick" style={{ left: '70%' }} aria-hidden="true" />
                  <span className="ctx-bar-tick" style={{ left: '90%' }} aria-hidden="true" />
                </div>
              </Tooltip>
            )}
          </div>
        )}

        {breakdown?.error && <span className="text-[11.5px] text-wait-fg">{breakdown.error}</span>}
      </div>
    </div>
  );
};
