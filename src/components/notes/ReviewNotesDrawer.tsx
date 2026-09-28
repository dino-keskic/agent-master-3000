import React, { useMemo, useState } from 'react';
import { Drawer, ScrollArea } from '@mantine/core';
import { BoardTask } from '../../../shared/types';
import {
  collectBoardComments,
  countBoardComments
} from '../../../shared/review/boardComments';
import { ReviewNoteCard } from './ReviewNoteCard';
import { MessageSquare } from 'lucide-react';

interface ReviewNotesDrawerProps {
  opened: boolean;
  onClose: () => void;
  tasks: BoardTask[];
  onSelectTask: (task: BoardTask, jumpCommentId?: string) => void;
  onApplyTask: (task: BoardTask) => void;
  onAddressComments?: (taskId: string) => void | Promise<void>;
}

type FilterTab = 'open' | 'resolved' | 'waiting_agent' | 'all';

/**
 * Board-wide review notes drawer overlay.
 * Matches Agent Master 3000.dc.html (lines 1253-1300).
 */
export const ReviewNotesDrawer: React.FC<ReviewNotesDrawerProps> = ({
  opened,
  onClose,
  tasks,
  onSelectTask,
  onApplyTask,
  onAddressComments
}) => {
  const [filter, setFilter] = useState<FilterTab>('open');

  const taskMap = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const allComments = useMemo(() => collectBoardComments(tasks), [tasks]);
  const counts = useMemo(() => countBoardComments(allComments), [allComments]);

  const filteredComments = useMemo(() => {
    if (filter === 'all') return allComments;
    return allComments.filter((c) => c.status === filter);
  }, [allComments, filter]);

  const handleAddressAll = () => {
    // Find first task with open comments and trigger addressComments or select it
    const target = tasks.find((t) => (t.changelogComments || []).some((c) => !c.resolvedAt));
    if (!target) return;
    if (onAddressComments) {
      void onAddressComments(target.id);
    } else {
      onSelectTask(target);
      onClose();
    }
  };

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="xl"
      title={
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-accent" />
            <h2 className="m-0 text-base font-bold text-ink tracking-tight">Review notes</h2>
          </div>
          <span className="text-xs text-ink-3">
            Across every task on the board — local to this machine, not GitHub.
          </span>
        </div>
      }
      styles={{
        header: {
          backgroundColor: 'rgb(var(--c-surface))',
          borderBottom: '1px solid rgb(var(--c-line))',
          padding: '14px 20px'
        },
        body: {
          backgroundColor: 'rgb(var(--c-canvas))',
          padding: 0,
          height: 'calc(100vh - 65px)',
          display: 'flex',
          flexDirection: 'column'
        }
      }}
    >
      {/* Top toolbar */}
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-line bg-surface/50 backdrop-blur-sm flex-wrap">
        <div className="flex items-center gap-1 p-0.5 border border-line rounded-lg bg-surface-2">
          <button
            type="button"
            onClick={() => setFilter('open')}
            className={`inline-flex items-center gap-1.5 h-6 px-2.5 text-xs font-medium rounded-md transition-colors cursor-pointer border-0 ${
              filter === 'open'
                ? 'bg-s4 text-ink shadow-card'
                : 'bg-transparent text-ink-3 hover:text-ink'
            }`}
          >
            Open
            <span className="font-mono text-[10px] text-ink-3">{counts.open}</span>
          </button>
          <button
            type="button"
            onClick={() => setFilter('resolved')}
            className={`inline-flex items-center gap-1.5 h-6 px-2.5 text-xs font-medium rounded-md transition-colors cursor-pointer border-0 ${
              filter === 'resolved'
                ? 'bg-s4 text-ink shadow-card'
                : 'bg-transparent text-ink-3 hover:text-ink'
            }`}
          >
            Resolved
            <span className="font-mono text-[10px] text-ink-3">{counts.resolved}</span>
          </button>
          <button
            type="button"
            onClick={() => setFilter('waiting_agent')}
            className={`inline-flex items-center gap-1.5 h-6 px-2.5 text-xs font-medium rounded-md transition-colors cursor-pointer border-0 ${
              filter === 'waiting_agent'
                ? 'bg-s4 text-ink shadow-card'
                : 'bg-transparent text-ink-3 hover:text-ink'
            }`}
          >
            Waiting on agent
            <span className="font-mono text-[10px] text-ink-3">{counts.waitingAgent}</span>
          </button>
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`inline-flex items-center gap-1.5 h-6 px-2.5 text-xs font-medium rounded-md transition-colors cursor-pointer border-0 ${
              filter === 'all'
                ? 'bg-s4 text-ink shadow-card'
                : 'bg-transparent text-ink-3 hover:text-ink'
            }`}
          >
            All
            <span className="font-mono text-[10px] text-ink-3">{counts.total}</span>
          </button>
        </div>

        {counts.open > 0 && (
          <button
            type="button"
            onClick={handleAddressAll}
            className="inline-flex items-center gap-1.5 h-[30px] px-3 border-0 rounded-lg bg-accent text-white text-xs font-semibold cursor-pointer hover:brightness-110 transition-all shadow-sm"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Address all {counts.open}
          </button>
        )}
      </div>

      {/* Threads list */}
      <ScrollArea className="flex-1 p-5" type="auto">
        <div className="flex flex-col gap-3.5 max-w-3xl mx-auto">
          {filteredComments.length === 0 ? (
            <div className="text-center py-12 text-ink-4 text-sm font-mono">
              No review notes in this view.
            </div>
          ) : (
            filteredComments.map((commentItem) => (
              <ReviewNoteCard
                key={`${commentItem.taskId}-${commentItem.comment.id}`}
                item={commentItem}
                task={taskMap.get(commentItem.taskId)}
                onSelectTask={(task, jumpCommentId) => {
                  onSelectTask(task, jumpCommentId);
                  onClose();
                }}
                onApplyTask={onApplyTask}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </Drawer>
  );
};
