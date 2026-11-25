import React from 'react';
import { Checkbox } from '@mantine/core';
import { FileDiff, GitBranch, Layers } from 'lucide-react';
import { SessionFilterTab, SessionTabCounts } from '../../../shared/sessions/import';
import { SegmentedControl } from '../ui';

const TABS: { value: SessionFilterTab; label: string; icon?: React.ReactNode }[] = [
  { value: 'all', label: 'All', icon: <Layers className="w-3 h-3" /> },
  {
    value: 'live',
    label: 'Live & Recent',
    icon: <span className="w-2 h-2 rounded-full bg-run animate-pulse inline-block" />
  },
  { value: 'worktrees', label: 'Worktrees', icon: <GitBranch className="w-3 h-3" /> },
  { value: 'diff', label: 'With Changes', icon: <FileDiff className="w-3 h-3" /> },
  { value: 'unimported', label: 'Unimported' },
  { value: 'imported', label: 'On Board' }
];

interface SessionFilterTabsProps {
  tab: SessionFilterTab;
  counts: SessionTabCounts;
  onTabChange: (tab: SessionFilterTab) => void;
  /** Sessions with nothing in them — hidden unless asked for. */
  untitledCount: number;
  showUntitled: boolean;
  onShowUntitledChange: (value: boolean) => void;
  showRemoved: boolean;
  onShowRemovedChange: (value: boolean) => void;
}

/** Which slice of the session list to show, and what to let back into it. */
export const SessionFilterTabs: React.FC<SessionFilterTabsProps> = ({
  tab,
  counts,
  onTabChange,
  untitledCount,
  showUntitled,
  onShowUntitledChange,
  showRemoved,
  onShowRemovedChange
}) => (
  <div className="flex items-center justify-between gap-2 flex-wrap">
    <SegmentedControl<SessionFilterTab>
      size="xs"
      value={tab}
      onChange={onTabChange}
      className="flex-wrap"
      options={TABS.map(({ value, label, icon }) => ({
        value,
        label,
        icon,
        count: counts[value]
      }))}
    />

    <div className="flex items-center gap-4">
      <Checkbox
        size="xs"
        label={<span className="text-[12px] text-ink-3">Include empty ({untitledCount})</span>}
        checked={showUntitled}
        onChange={(e) => onShowUntitledChange(e.currentTarget.checked)}
      />
      <Checkbox
        size="xs"
        label={<span className="text-[12px] text-ink-3">Include removed worktrees</span>}
        checked={showRemoved}
        onChange={(e) => onShowRemovedChange(e.currentTarget.checked)}
      />
    </div>
  </div>
);
