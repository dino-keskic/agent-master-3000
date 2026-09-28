import React from 'react';
import { Group } from '@mantine/core';
import { Folder, TriangleAlert } from 'lucide-react';
import { BoardColumn, BoardTask } from '../../../shared/types';
import { TaskChangeSummary } from '../../../shared/git/changeSummary';
import { previewLines } from '../../../shared/sessions/list';
import { taskCardSummary } from '../../../shared/task/card';
import { linkSettlement, settlementLabel } from '../../../shared/trackers/linkStatus';
import { taskHref } from '../../../shared/ids';
import { trackerLinks } from '../../../shared/task/links';
import { Type } from '../ui';
import { InlineMarkdown } from '../stream/Markdown';
import { CardAction } from './CardAction';
import { CardHeader } from './CardHeader';
import { ChangeSummaryRow } from './ChangeSummaryRow';
import { RunProgress } from './RunProgress';
import { TrackerLinks } from './TrackerLinks';

interface TaskCardProps {
  task: BoardTask;
  column?: BoardColumn;
  /** The computed change summary, once the board's batched fetch lands. */
  change?: TaskChangeSummary;
  onSelect: (task: BoardTask) => void;
  onArchive: (taskId: string) => void;
  onStop: (taskId: string) => void;
  onRun: (taskId: string) => void;
}

/**
 * Memoised: a board update pushes a fresh snapshot for one task, and without
 * this every other card re-renders with it — Mantine paper, tooltips, icons and
 * all — several times a second for the whole of a running turn. The handler
 * props are held stable in `App` so the comparison is worth making.
 */
export const TaskCard: React.FC<TaskCardProps> = React.memo(({ task, column, change, onSelect, onArchive, onStop, onRun }) => {
  const summary = taskCardSummary(task, column);
  const lines = previewLines(task);
  const preview = summary.waitingDetail || lines.agent || lines.user;
  const stateClass = summary.waiting
    ? 'is-waiting'
    : summary.running
      ? 'is-running'
      : summary.hasError
        ? 'is-error'
        : '';
  // A turn still in flight wins over a merged PR: the card is working, not done.
  const settledLabel = summary.waiting || summary.running ? undefined : settlementLabel(linkSettlement(task.links));

  return (
    <article
      className={`glass-card task-card rounded-xl p-4 cursor-pointer relative group flex flex-col gap-3 ${
        summary.folderGone ? 'opacity-60' : settledLabel ? 'is-settled' : ''
      } ${stateClass}`}
    >
      {/* The card is one big link, so a middle click or ⌘-click opens the task
          in a tab like anything else on the web. It is not draggable: the
          overlay covers the card, so a native link drag would start here and
          the board would drag a URL chip instead of the card itself. */}
      <a
        href={taskHref(task.id)}
        draggable={false}
        className="absolute inset-0 z-[1] rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label={summary.openLabel}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          onSelect(task);
        }}
      />

      <CardHeader
        taskId={task.id}
        summary={summary}
        model={task.model}
        agent={task.agent}
        thinkingLevel={task.thinkingLevel}
        onArchive={onArchive}
      />

      <Type as="h3" role="title" className="m-0 line-clamp-2">{task.title}</Type>

      <TrackerLinks links={trackerLinks(task.links)} />

      {summary.currentTool ? (
        <RunProgress tool={summary.currentTool} nextPrompt={summary.nextPrompt} />
      ) : (
        preview && (
          <Type role="copy" className="line-clamp-2">
            <InlineMarkdown text={preview} />
          </Type>
        )
      )}

      {change && <ChangeSummaryRow summary={change} />}

      <Group justify="space-between" align="center" wrap="nowrap" gap="xs" className="pt-0.5">
        {/* The project gets a line of its own: across a board of several
            repos it is what you scan for, and sharing a line with the numbers
            meant it was the first thing cut. */}
        <div className="min-w-0 flex-1 flex flex-col gap-0.5">
          {summary.place && (
            <span
              className={`inline-flex items-center gap-1 min-w-0 text-[12px] font-medium ${
                summary.folderGone ? 'text-err-fg' : 'text-ink-2'
              }`}
              title={summary.folderGone ? `Folder gone: ${task.cwd || summary.place}` : task.cwd || summary.place}
            >
              <Folder className="w-3 h-3 shrink-0 text-ink-4" />
              <span className="truncate">{summary.place}</span>
              {/* An icon, not words: the name is what must survive a narrow
                  column, and the tooltip says what is wrong. */}
              {summary.folderGone && summary.place !== 'folder gone' && (
                <TriangleAlert className="w-3 h-3 shrink-0" aria-label="folder gone" />
              )}
            </span>
          )}
          <Type role="meta" className="truncate min-w-0">
            {settledLabel && <span>{settledLabel}</span>}
            {settledLabel && summary.meta.length > 0 && <span className="text-ink-4"> · </span>}
            {summary.meta.map((part, i) => (
              <React.Fragment key={`${part}-${i}`}>
                {i > 0 && <span className="text-ink-4"> · </span>}
                <Type role="meta" as="span" tone={part === summary.cost ? 'muted' : 'faint'}>{part}</Type>
              </React.Fragment>
            ))}
          </Type>
        </div>

        <CardAction task={task} summary={summary} onSelect={onSelect} onStop={onStop} onRun={onRun} />
      </Group>
    </article>
  );
});

TaskCard.displayName = 'TaskCard';
