import React from 'react';
import { Badge, Checkbox, Group, SegmentedControl, Text } from '@mantine/core';
import { FileDiff, GitBranch, Layers } from 'lucide-react';
import { SessionFilterTab, SessionTabCounts } from '../../../shared/sessions/import';

const TABS: { value: SessionFilterTab; label: string; icon?: React.ReactNode }[] = [
  { value: 'all', label: 'All', icon: <Layers className="w-3.5 h-3.5" /> },
  {
    value: 'live',
    label: 'Live & Recent',
    icon: <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
  },
  { value: 'worktrees', label: 'Worktrees', icon: <GitBranch className="w-3.5 h-3.5" /> },
  { value: 'diff', label: 'With Changes', icon: <FileDiff className="w-3.5 h-3.5" /> },
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
};

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
  <Group justify="space-between" align="center" wrap="wrap" gap="xs">
    <SegmentedControl
      size="xs"
      value={tab}
      onChange={(val) => onTabChange(val as SessionFilterTab)}
      data={TABS.map(({ value, label, icon }) => ({
        value,
        label: (
          <Group gap={6} wrap="nowrap">
            {icon}
            <span>{label}</span>
            <Badge size="xs" color="gray" variant="light" circle className="font-mono">
              {counts[value]}
            </Badge>
          </Group>
        )
      }))}
      styles={{
        root: { backgroundColor: 'rgb(var(--c-surface-2))', borderColor: 'rgb(var(--c-line))' },
        label: { padding: '4px 10px' }
      }}
    />

    <Group gap="md">
      <Checkbox
        size="xs"
        label={<Text size="xs" c="dimmed">Include Empty ({untitledCount})</Text>}
        checked={showUntitled}
        onChange={(e) => onShowUntitledChange(e.currentTarget.checked)}
      />
      <Checkbox
        size="xs"
        label={<Text size="xs" c="dimmed">Include Removed Worktrees</Text>}
        checked={showRemoved}
        onChange={(e) => onShowRemovedChange(e.currentTarget.checked)}
      />
    </Group>
  </Group>
);
