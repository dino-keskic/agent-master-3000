import React from 'react';
import { Drawer, Loader, ScrollArea, Tooltip } from '@mantine/core';
import { Coins, RefreshCw } from 'lucide-react';
import { SpendSummary } from '../../../shared/spend/types';
import { SpendTiles } from './SpendTiles';
import { SpendAverageTabs } from './SpendAverageTabs';
import { SpendDayChart } from './SpendDayChart';
import { SpendBreakdownCard } from './SpendBreakdownCard';
import { TopSessionsTable } from './TopSessionsTable';
import { SpendSkeleton, SpendUnavailable } from './SpendPlaceholder';

/**
 * What the board is costing.
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
    size="min(1180px, 96vw)"
    title={
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Coins className="w-4 h-4 text-accent" />
        <span className="text-[14px] font-semibold text-ink">Spend</span>
        <span className="text-[12px] text-ink-3">
          Assistant turns — cache reads and writes are included.
        </span>
        {loading && <Loader size="xs" color="gray" />}
      </div>
    }
    styles={{
      content: { backgroundColor: 'var(--glass-pane)', color: 'rgb(var(--c-ink))' },
      header: { backgroundColor: 'rgb(var(--c-surface))', borderBottom: '1px solid rgb(var(--c-line))' },
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
          <span className="font-mono text-[11px] text-ink-4">
            {summary ? `read ${new Date(summary.generatedAt).toLocaleTimeString()}` : 'not read yet'}
          </span>
          <Tooltip label="Re-read from OpenCode" withArrow>
            <button
              type="button"
              className="icon-btn"
              onClick={onRefresh}
              aria-label="Refresh spend"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>
    </ScrollArea>
  </Drawer>
);
