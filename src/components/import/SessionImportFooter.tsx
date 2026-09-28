import React from 'react';
import { Button, Group, Loader, Text } from '@mantine/core';
import { CheckCheck, Download } from 'lucide-react';

interface SessionImportFooterProps {
  shown: number;
  total: number;
  projectCount: number;
  /** Set while a bulk import is running, which replaces the buttons. */
  progress: { done: number; total: number } | null;
  selectedCount: number;
  /** Sessions on screen that are not on the board yet. */
  selectableCount: number;
  allSelected: boolean;
  busy: boolean;
  onToggleAll: () => void;
  onImport: () => void;
}

/** What the list is showing, and what to do with what is selected in it. */
export const SessionImportFooter: React.FC<SessionImportFooterProps> = ({
  shown,
  total,
  projectCount,
  progress,
  selectedCount,
  selectableCount,
  allSelected,
  busy,
  onToggleAll,
  onImport
}) => (
  <Group justify="space-between" align="center" wrap="nowrap" className="pt-1">
    <Text size="xs" c="dimmed" className="font-mono text-[12px]">
      Showing <span className="text-slate-200 font-bold">{shown}</span> of {total} session{total === 1 ? '' : 's'}
      {projectCount > 0 ? ` across ${projectCount} project${projectCount === 1 ? '' : 's'}` : ''}
    </Text>

    <Group gap="xs" wrap="nowrap">
      {progress ? (
        <Group gap="sm" wrap="nowrap" className="bg-acc-bg px-3 py-1.5 rounded-lg border border-acc-bd">
          <Loader size="xs" color="accent" />
          <Text size="xs" className="font-mono text-acc-fg">
            Importing {progress.done + 1} of {progress.total}…
          </Text>
        </Group>
      ) : (
        <>
          <Button
            size="xs"
            variant="subtle"
            color="gray"
            disabled={selectableCount === 0}
            onClick={onToggleAll}
            leftSection={<CheckCheck className="w-3.5 h-3.5" />}
          >
            {allSelected ? 'Clear Selection' : `Select All (${selectableCount})`}
          </Button>
          <Button
            size="sm"
            color="accent"
            variant="filled"
            disabled={selectedCount === 0 || busy}
            onClick={onImport}
            leftSection={<Download className="w-4 h-4" />}
          >
            Import {selectedCount > 0 ? `(${selectedCount})` : ''} to Board
          </Button>
        </>
      )}
    </Group>
  </Group>
);
