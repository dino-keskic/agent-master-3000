import React, { useMemo, useState } from 'react';
import { Drawer, ScrollArea } from '@mantine/core';
import { MessageSquare } from 'lucide-react';
import { BoardTask } from '../../../shared/types';
import { collectBoardComments, countBoardComments } from '../../../shared/review/boardComments';
import { Button, Chip, EmptyState, PaneToolbar, SearchInput, SegmentedControl } from '../ui';
import { ReviewNoteCard } from './ReviewNoteCard';

interface ReviewNotesDrawerProps {
  opened: boolean;
  onClose: () => void;
  tasks: BoardTask[];
  onSelectTask: (task: BoardTask, jumpCommentId?: string) => void;
  onApplyTask: (task: BoardTask) => void;
  onAddressComments?: (taskId: string) => void | Promise<void>;
}

type FilterTab = 'open' | 'waiting_agent' | 'resolved' | 'all';

/**
 * Board-wide review notes drawer overlay.
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
  const [query, setQuery] = useState('');

  const taskMap = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const allComments = useMemo(() => collectBoardComments(tasks), [tasks]);
  const counts = useMemo(() => countBoardComments(allComments), [allComments]);

  const filteredComments = useMemo(() => {
    const byTab = allComments.filter((c) => {
      if (filter === 'all') return true;
      // Open shows all non-resolved comments so its list always matches `counts.open`.
      if (filter === 'open') return c.status !== 'resolved';
      return c.status === filter;
    });
    const q = query.trim().toLowerCase();
    if (!q) return byTab;
    return byTab.filter(
      (c) =>
        c.taskId.toLowerCase().includes(q) ||
        c.taskTitle.toLowerCase().includes(q) ||
        c.location.toLowerCase().includes(q) ||
        c.comment.body.toLowerCase().includes(q)
    );
  }, [allComments, filter, query]);

  const handleAddressAll = () => {
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
            <h2 className="m-0 text-[14px] font-semibold text-ink">Review notes</h2>
            {counts.open > 0 && <Chip tone="accent">{counts.open} open</Chip>}
          </div>
          <span className="text-[11.5px] text-ink-3">
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
          backgroundColor: 'var(--glass-pane)',
          padding: 0,
          height: 'calc(100vh - 65px)',
          display: 'flex',
          flexDirection: 'column'
        }
      }}
    >
      <PaneToolbar
        left={
          <div className="flex items-center gap-2 flex-wrap">
            <SegmentedControl<FilterTab>
              size="xs"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'open', label: 'Open', count: counts.open },
                { value: 'waiting_agent', label: 'Waiting on agent', count: counts.waitingAgent },
                { value: 'resolved', label: 'Resolved', count: counts.resolved },
                { value: 'all', label: 'All', count: counts.total }
              ]}
            />
            {allComments.length > 0 && (
              <SearchInput
                value={query}
                onChange={setQuery}
                placeholder="Filter notes…"
                containerClassName="w-48 max-w-full"
              />
            )}
          </div>
        }
        right={
          counts.open > 0 ? (
            <Button
              size="sm"
              variant="primary"
              onClick={handleAddressAll}
              leftSection={<MessageSquare className="w-3.5 h-3.5" />}
            >
              Address {counts.open === 1 ? 'note' : `all ${counts.open}`}
            </Button>
          ) : undefined
        }
      />

      <ScrollArea className="flex-1 p-4" type="auto">
        <div className="flex flex-col gap-3 max-w-3xl mx-auto">
          {filteredComments.length === 0 ? (
            <EmptyState
              icon={<MessageSquare className="w-4 h-4" />}
              title={query.trim() ? 'No matching review notes' : 'No review notes in this view'}
              description={
                query.trim()
                  ? `No review note matches "${query}".`
                  : "Click any line number in a task's Changes tab to leave an inline review note for the agent."
              }
            />
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
