import React from 'react';
import { Text } from '@mantine/core';
import { FolderGit2, GitBranch } from 'lucide-react';
import { ChangelogComment } from '../../../shared/types';
import { workspaceTitle } from '../../../shared/task/workspaces';
import { WorkspaceDiff } from '../../api';
import { FileBlock } from './FileBlock';
import { DraftControls, ThreadControls } from './controls';

/**
 * One folder's worth of the Changes tab.
 *
 * A task working in two repositories has two diffs, and a file only means
 * something under the folder it came from — so each folder is a titled band
 * with its own branch, its own totals and its own files. A task working in one
 * folder is the ordinary case and gets no band at all: the header would be a
 * label on the only thing there is.
 */

export interface WorkspaceSectionProps {
  workspace: WorkspaceDiff;
  /** The notes on this folder, already narrowed to it. */
  comments: ChangelogComment[];
  /** True when this is the only folder, so the heading is left off. */
  alone: boolean;
  isCollapsed: (cwd: string, path: string) => boolean;
  toggle: (cwd: string, path: string) => void;
  onOpenFile?: (path: string, line?: number, cwd?: string) => void;
  drafts: DraftControls;
  threads: ThreadControls;
  emptyLabel: string;
}

const WorkspaceHeader: React.FC<{ workspace: WorkspaceDiff }> = ({ workspace }) => (
  <div className="flex items-center gap-2 px-1 pt-1 pb-2">
    <FolderGit2 className="w-3.5 h-3.5 text-ink-3 shrink-0" />
    <span className="font-mono text-[12px] font-semibold text-ink truncate" title={workspace.cwd}>
      {workspaceTitle(workspace)}
    </span>
    {workspace.branch && (
      <span className="flex items-center gap-1 font-mono text-[11px] text-ink-3 shrink-0">
        <GitBranch className="w-3 h-3" />
        {workspace.branch}
      </span>
    )}
    <span className="flex-1" />
    {!workspace.error && (
      <span className="font-mono text-[11px] text-ink-3 shrink-0">
        {workspace.stat.files} file{workspace.stat.files === 1 ? '' : 's'}{' '}
        <span className="text-add">+{workspace.stat.additions}</span>{' '}
        <span className="text-del">−{workspace.stat.deletions}</span>
      </span>
    )}
  </div>
);

export const WorkspaceSection: React.FC<WorkspaceSectionProps> = ({
  workspace,
  comments,
  alone,
  isCollapsed,
  toggle,
  onOpenFile,
  drafts,
  threads,
  emptyLabel
}) => (
  <div className={alone ? undefined : 'mb-4 border-t border-line/60 pt-2 first:border-t-0 first:pt-0'}>
    {!alone && <WorkspaceHeader workspace={workspace} />}

    {workspace.error ? (
      <Text size="sm" c="dimmed" ta="center" py={alone ? 'xl' : 'sm'}>
        {workspace.error}
      </Text>
    ) : workspace.files.length === 0 ? (
      <Text size="sm" c="dimmed" ta={alone ? 'center' : 'left'} px={alone ? undefined : 'xs'} py={alone ? 'md' : 4}>
        {emptyLabel}
      </Text>
    ) : (
      <>
        {workspace.truncated && (
          <Text size="xs" c="dimmed" px="xs" pb="xs">
            The diff was too large to load completely — some files are missing.
          </Text>
        )}
        {workspace.files.map((file) => (
          <FileBlock
            key={`${file.status}:${file.path}`}
            file={file}
            cwd={workspace.cwd}
            comments={comments}
            collapsed={isCollapsed(workspace.cwd, file.path)}
            onToggle={() => toggle(workspace.cwd, file.path)}
            onOpenFile={onOpenFile && ((path, line) => onOpenFile(path, line, workspace.cwd))}
            drafts={drafts}
            threads={threads}
          />
        ))}
      </>
    )}
  </div>
);
