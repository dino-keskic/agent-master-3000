import React from 'react';
import { Button, Group, SegmentedControl, Text, Tooltip } from '@mantine/core';
import { RefreshCw } from 'lucide-react';
import { sumDiffStats } from '../../../shared/git/diff';
import { DiffScope, WorkspaceDiff } from '../../api';

/**
 * What is being diffed, how big it is, and a way to read it again.
 *
 * The totals here are the whole task's, added up across every folder it works
 * in — the per-folder counts belong on the folder headings below. When there is
 * more than one folder the count of them is said out loud, so a small number
 * next to a big diff does not look like a mistake.
 */
export const DiffToolbar: React.FC<{
  scope: DiffScope;
  workspaces: WorkspaceDiff[] | null;
  onScope: (scope: DiffScope) => void;
  onReload: () => void;
}> = ({ scope, workspaces, onScope, onReload }) => {
  const readable = (workspaces || []).filter((workspace) => !workspace.error);
  const stat = sumDiffStats(readable.map((workspace) => workspace.stat));
  const bases = [...new Set(readable.map((workspace) => workspace.baseRef).filter(Boolean))];

  return (
    <Group justify="space-between" px="sm" py={8} className="border-b border-line/80 shrink-0">
      <SegmentedControl
        size="xs"
        value={scope}
        onChange={(value) => onScope(value as DiffScope)}
        data={[
          { label: 'Uncommitted', value: 'uncommitted' },
          { label: 'vs base branch', value: 'branch' }
        ]}
      />
      <Group gap="xs">
        {readable.length > 0 && (
          <Text size="xs" className="font-mono text-ink-2">
            {stat.files} file{stat.files === 1 ? '' : 's'}{' '}
            <span className="text-emerald-400">+{stat.additions}</span>{' '}
            <span className="text-rose-400">−{stat.deletions}</span>
            {readable.length > 1 && (
              <span className="text-ink-4"> · {readable.length} folders</span>
            )}
            {bases.length === 1 && <span className="text-ink-4"> · vs {bases[0]}</span>}
          </Text>
        )}
        <Tooltip label="Refresh" withArrow>
          <Button
            size="compact-xs"
            variant="subtle"
            color="gray"
            onClick={onReload}
            aria-label="Refresh diff"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </Tooltip>
      </Group>
    </Group>
  );
};
