import React from 'react';
import { ActionIcon, Drawer, Loader, ScrollArea, Tooltip } from '@mantine/core';
import { RefreshCw } from 'lucide-react';
import { SpendSummary } from '../../../shared/spend/types';
import { SpendTiles } from './SpendTiles';
import { SpendAverageTabs } from './SpendAverageTabs';
import { SpendDayChart } from './SpendDayChart';
import { SpendBreakdownCard } from './SpendBreakdownCard';
import { TopSessionsTable } from './TopSessionsTable';
import { SpendSkeleton, SpendUnavailable } from './SpendPlaceholder';

/**
 * What the board is costing.
 *
 * Every card carries a dollar figure and none of them answer the question those
 * figures raise. This is the arrangement of the answer — the tiles, what a day
 * and a week average, the month by day, the three rankings, the sessions that
 * ran the bill up — and nothing else: the sums live in `shared/spend/` and
 * each region in `spend/`.
 *
 * Matches Agent Master 3000.dc.html, the Costs screen (lines 1304-1457). It is a wide
 * screen there and a right-hand drawer here, so the four tiles and the three
 * breakdowns collapse to one column rather than being cut down.
 */

interface SpendPanelProps {
  opened: boolean;
  onClose: () => void;
  summary: SpendSummary | null;
  loading: boolean;
  onRefresh: () => void;
}

const monthLabel = (at: number) =>
  new Date(at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

const SpendBody: React.FC<{ summary: SpendSummary }> = ({ summary }) => (
  <>
    <SpendTiles summary={summary} />
    <SpendAverageTabs summary={summary} />
    <SpendDayChart daily={summary.daily} />
    <div className="grid gap-3.5 lg:grid-cols-3">
      <SpendBreakdownCard title="By model" buckets={summary.byModel} tone="accent" />
      <SpendBreakdownCard title="By project" buckets={summary.byProject} tone="run" />
      <SpendBreakdownCard title="By agent" buckets={summary.byAgent} tone="wait" />
    </div>
    <TopSessionsTable rows={summary.topSessions} windowLabel={monthLabel(summary.month.from)} />
  </>
);

export const SpendPanel: React.FC<SpendPanelProps> = ({ opened, onClose, summary, loading, onRefresh }) => (
  <Drawer
    opened={opened}
    onClose={onClose}
    position="right"
    // The design is a full screen; a drawer this wide is the most of it that
    // fits without taking the board away behind it.
    size="min(1180px, 96vw)"
    title={
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">Spend</span>
        <span className="text-[13px] text-ink-3">
          Assistant turns — cache reads and writes are included.
        </span>
        {/* The read is half a second; the spinner rides beside the heading so a
            refresh never blanks the figures already on screen. */}
        {loading && <Loader size="xs" color="gray" />}
      </div>
    }
    styles={{
      content: { backgroundColor: 'rgb(var(--c-canvas))', color: 'rgb(var(--c-ink))' },
      header: { backgroundColor: 'rgb(var(--c-surface-3))', borderBottom: '1px solid rgb(var(--c-line) / 0.7)' },
      body: { padding: 0, height: 'calc(100vh - 60px)', display: 'flex', flexDirection: 'column' }
    }}
  >
    <ScrollArea className="flex-1" type="auto">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-3.5 p-4">
        {!summary ? (
          loading ? (
            <SpendSkeleton />
          ) : (
            <SpendUnavailable
              reason="No spend read yet."
              hint="Refresh to read the last month out of OpenCode."
            />
          )
        ) : summary.error ? (
          <SpendUnavailable reason={summary.error} hint="Spend comes from OpenCode's own database." />
        ) : (
          <SpendBody summary={summary} />
        )}

        <div className="flex items-center justify-between pb-2">
          <span className="font-mono text-[10px] text-ink-4">
            {summary ? `read ${new Date(summary.generatedAt).toLocaleTimeString()}` : 'not read yet'}
          </span>
          <Tooltip label="Re-read from OpenCode" withArrow>
            <ActionIcon variant="subtle" color="gray" size="sm" onClick={onRefresh} aria-label="Refresh spend">
              <RefreshCw className="h-3.5 w-3.5" />
            </ActionIcon>
          </Tooltip>
        </div>
      </div>
    </ScrollArea>
  </Drawer>
);
