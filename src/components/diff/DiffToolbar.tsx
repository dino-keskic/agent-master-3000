import React from 'react';
import { Tooltip } from '@mantine/core';
import { ChevronsDownUp, ChevronsUpDown, RefreshCw } from 'lucide-react';
import { sumDiffStats } from '../../../shared/git/diff';
import { DiffScope, WorkspaceDiff } from '../../api';
import { Chip, PaneToolbar, SegmentedControl } from '../ui';

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
  onExpandAll?: () => void;
  onCollapseAll?: () => void;
}> = ({ scope, workspaces, onScope, onReload, onExpandAll, onCollapseAll }) => {
  const readable = (workspaces || []).filter((workspace) => !workspace.error);
  const stat = sumDiffStats(readable.map((workspace) => workspace.stat));
  const bases = [...new Set(readable.map((workspace) => workspace.baseRef).filter(Boolean))];
  const multipleFiles = readable.reduce((n, w) => n + w.files.length, 0) > 1;

  return (
    <PaneToolbar
      left={
        <SegmentedControl<DiffScope>
          size="xs"
          value={scope}
          onChange={onScope}
          options={[
            { label: 'Uncommitted', value: 'uncommitted' },
            { label: 'vs base branch', value: 'branch' }
          ]}
        />
      }
      right={
        <>
          {readable.length > 0 && (
            <div className="flex items-center gap-1.5 font-mono text-[12px] text-ink-2">
              <Chip className="font-mono">
                {stat.files} file{stat.files === 1 ? '' : 's'}
              </Chip>
              <Chip className="font-mono gap-1.5">
                <span className="text-add">+{stat.additions}</span>
                <span className="text-del">−{stat.deletions}</span>
              </Chip>
              {readable.length > 1 && (
                <span className="text-ink-4 text-[11px]">· {readable.length} folders</span>
              )}
              {bases.length === 1 && <span className="text-ink-4 text-[11px]">· vs {bases[0]}</span>}
            </div>
          )}
          {multipleFiles && onExpandAll && (
            <Tooltip label="Expand all files" withArrow>
              <button
                type="button"
                className="icon-btn"
                onClick={onExpandAll}
                aria-label="Expand all files"
              >
                <ChevronsUpDown className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          )}
          {multipleFiles && onCollapseAll && (
            <Tooltip label="Collapse all files" withArrow>
              <button
                type="button"
                className="icon-btn"
                onClick={onCollapseAll}
                aria-label="Collapse all files"
              >
                <ChevronsDownUp className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          )}
          <Tooltip label="Refresh diff" withArrow>
            <button
              type="button"
              className="icon-btn"
              onClick={onReload}
              aria-label="Refresh diff"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </>
      }
    />
  );
};
