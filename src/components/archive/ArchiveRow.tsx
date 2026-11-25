import React, { useState } from 'react';
import { Tooltip } from '@mantine/core';
import { ChevronDown, ChevronRight, Folder, MessageSquare, RotateCcw, Trash2 } from 'lucide-react';
import { BoardColumn, BoardTask } from '../../../shared/types';
import { relativeTime } from '../../../shared/format';
import { restoreColumnId, restoreRehomes } from '../../../shared/task/archive';
import { Button, Chip, Surface } from '../ui';

/**
 * One archived task: what it was, where it came from, and when it left.
 *
 * The column line says where a restore actually lands, because the column a
 * task was archived from can be edited away while it sits here — the rule is
 * `restoreColumnId`, and this is the one place the user gets to see it before
 * clicking.
 */

interface ArchiveRowProps {
  task: BoardTask;
  onRestore: (taskId: string) => void;
  columns: BoardColumn[];
  projectLabel?: string;
  onDeleteForever: (taskId: string) => void;
}

export const ArchiveRow: React.FC<ArchiveRowProps> = ({
  task,
  columns,
  projectLabel,
  onRestore,
  onDeleteForever
}) => {
  const [expanded, setExpanded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const targetId = restoreColumnId(task, columns);
  const rehomed = restoreRehomes(task, columns);
  const columnTitle = columns.find((column) => column.id === targetId)?.title || targetId;
  const sessionCount = task.sessions?.length || (task.sessionId ? 1 : 0);
  const noteCount = task.changelogComments?.length || 0;
  const promptPreview = (task.originalPrompt || task.prompt || '').trim();
  const lastReply = (task.lastMessage || '').trim();
  const hasPreview = !!(promptPreview || lastReply || task.cwd);

  return (
    <Surface level="s2" border="default" radius="lg" className="p-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5 min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            {hasPreview && (
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                aria-expanded={expanded}
                aria-label={expanded ? `Collapse ${task.id} details` : `Expand ${task.id} details`}
                className="w-5 h-5 rounded flex items-center justify-center border-0 bg-transparent text-ink-3 hover:text-ink hover:bg-s3h cursor-pointer shrink-0 p-0"
              >
                {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
            )}
            <Chip className="font-mono shrink-0">{task.id}</Chip>
            <button
              type="button"
              onClick={() => hasPreview && setExpanded((e) => !e)}
              className={`text-left text-[13px] font-semibold text-ink truncate border-0 bg-transparent p-0 min-w-0 ${
                hasPreview ? 'cursor-pointer hover:text-accent' : ''
              }`}
              title={task.title}
            >
              {task.title}
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap text-[11px] font-mono text-ink-3 pl-0.5">
            {projectLabel && (
              <span className="inline-flex items-center gap-1 truncate">
                <Folder className="w-3 h-3 opacity-60 shrink-0" />
                {projectLabel}
              </span>
            )}
            <Chip tone={rehomed ? 'wait' : 'neutral'}>
              {rehomed ? `→ ${columnTitle}` : columnTitle}
            </Chip>
            {sessionCount > 0 && (
              <span className="text-ink-4 shrink-0">
                {sessionCount} {sessionCount === 1 ? 'session' : 'sessions'}
              </span>
            )}
            {noteCount > 0 && (
              <span className="inline-flex items-center gap-0.5 text-ink-4 shrink-0">
                <MessageSquare className="w-2.5 h-2.5" />
                {noteCount}
              </span>
            )}
            {task.archivedAt !== undefined && (
              <span className="text-ink-4 shrink-0">
                archived {relativeTime(task.archivedAt)}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {confirmingDelete ? (
            <>
              <Button
                size="xs"
                variant="danger"
                className="!bg-err-bg !border-err-bd !text-err-fg"
                onClick={() => onDeleteForever(task.id)}
              >
                Delete forever
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Tooltip
                label={
                  rehomed
                    ? `Its column is gone — restores to ${columnTitle}`
                    : `Restore to ${columnTitle}`
                }
                withArrow
              >
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => onRestore(task.id)}
                  leftSection={<RotateCcw className="w-3 h-3" />}
                >
                  Restore
                </Button>
              </Tooltip>
              <Tooltip label="Delete forever — this cannot be undone" withArrow>
                <Button
                  size="icon-sm"
                  variant="danger"
                  aria-label={`Delete ${task.id} forever`}
                  onClick={() => setConfirmingDelete(true)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </Tooltip>
            </>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-1 pt-2 border-t border-hairline flex flex-col gap-1.5 text-[12px]">
          {promptPreview && (
            <div className="rounded-md bg-surface px-2.5 py-2 border border-hairline">
              <div className="font-mono text-[10px] uppercase tracking-wider text-ink-4 mb-0.5">Prompt</div>
              <div className="text-ink-2 whitespace-pre-wrap line-clamp-4">{promptPreview}</div>
            </div>
          )}
          {lastReply && lastReply !== promptPreview && (
            <div className="rounded-md bg-surface px-2.5 py-2 border border-hairline">
              <div className="font-mono text-[10px] uppercase tracking-wider text-ink-4 mb-0.5">Last output</div>
              <div className="text-ink-2 whitespace-pre-wrap line-clamp-3">{lastReply}</div>
            </div>
          )}
          {task.cwd && (
            <div className="font-mono text-[11px] text-ink-4 truncate" title={task.cwd}>
              cwd: {task.cwd}
            </div>
          )}
        </div>
      )}
    </Surface>
  );
};
