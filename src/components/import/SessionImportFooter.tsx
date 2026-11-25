import React from 'react';
import { Loader } from '@mantine/core';
import { CheckCheck, Download } from 'lucide-react';
import { Button, Chip } from '../ui';

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
  <div className="flex items-center justify-between gap-3 pt-1 flex-wrap">
    <span className="font-mono text-[12px] text-ink-3">
      Showing <span className="text-ink font-semibold">{shown}</span> of {total} session{total === 1 ? '' : 's'}
      {projectCount > 0 ? ` across ${projectCount} project${projectCount === 1 ? '' : 's'}` : ''}
    </span>

    <div className="flex items-center gap-2">
      {progress ? (
        <Chip tone="accent" className="gap-2 px-3 py-1 font-mono">
          <Loader size={12} color="accent" />
          <span>
            Importing {progress.done + 1} of {progress.total}…
          </span>
        </Chip>
      ) : (
        <>
          <Button
            size="sm"
            variant="ghost"
            disabled={selectableCount === 0}
            onClick={onToggleAll}
            leftSection={<CheckCheck className="w-3.5 h-3.5" />}
          >
            {allSelected ? 'Clear selection' : `Select all (${selectableCount})`}
          </Button>
          <Button
            size="md"
            variant="primary"
            disabled={selectedCount === 0 || busy}
            onClick={onImport}
            leftSection={<Download className="w-4 h-4" />}
          >
            Import {selectedCount > 0 ? `(${selectedCount})` : ''} to board
          </Button>
        </>
      )}
    </div>
  </div>
);
