import React from 'react';
import { Tooltip } from '@mantine/core';
import { Archive, Folder, Play, Square } from 'lucide-react';
import { BoardColumn, BoardTask } from '../../../shared/types';
import {
  TaskChangeSummary,
  changeDetailLabel,
  changeScopeLabel,
  formatChangeDigest,
  summarizeChanges
} from '../../../shared/git/changeSummary';
import { cardRunBadges, cardStatusLine, taskCardSummary } from '../../../shared/task/card';
import { linkSettlement, settlementLabel } from '../../../shared/trackers/linkStatus';
import { taskHref } from '../../../shared/ids';
import { trackerLinks } from '../../../shared/task/links';
import { TrackerLinks } from './TrackerLinks';
import './card.css';

interface TaskCardProps {
  task: BoardTask;
  column?: BoardColumn;
  /** The computed change summary, once the board's batched fetch lands. */
  change?: TaskChangeSummary;
  /** What a new task would run with; a card names its own only when it differs. */
  defaultModel?: string;
  defaultAgent?: string;
  /** The keyboard walk is on this card. */
  focused?: boolean;
  onSelect: (task: BoardTask) => void;
  onArchive: (taskId: string) => void;
  onStop: (taskId: string) => void;
  onRun: (taskId: string) => void;
}

/**
 * A task, in three lines: what it is, what it is doing, where it lives.
 *
 * The middle line is the one decision (`cardStatusLine`): the question it is
 * asking, the tool it is running, the diff it left. Only a card that is
 * waiting or broken is coloured, and Run / Stop / Archive appear on hover, so
 * a column at rest is a list of titles rather than a wall of chips and buttons.
 *
 * Memoised: a board update pushes a fresh snapshot for one task, and without
 * this every other card re-renders with it several times a second for the
 * whole of a running turn. The handler props are held stable in `App` so the
 * comparison is worth making.
 */
export const TaskCard: React.FC<TaskCardProps> = React.memo(
  ({ task, column, change, defaultModel, defaultAgent, focused, onSelect, onArchive, onStop, onRun }) => {
    const summary = taskCardSummary(task, column);
    // A turn still in flight wins over a merged PR: the card is working, not done.
    const settledLabel = summary.waiting || summary.running ? undefined : settlementLabel(linkSettlement(task.links));
    const digest = change ? summarizeChanges(change) : undefined;
    const status = cardStatusLine(task, summary, {
      settledLabel,
      changeText: digest && digest.files > 0 ? formatChangeDigest(digest) : undefined
    });
    const statusTitle =
      status.tone === 'quiet' && change && digest && digest.files > 0
        ? [changeScopeLabel(change), changeDetailLabel(digest)].filter(Boolean).join(' · ')
        : status.text;

    const meta = [
      ...cardRunBadges(task, { model: defaultModel, agent: defaultAgent }),
      summary.queuedCount > 0 && status.tone !== 'quiet' ? `${summary.queuedCount} queued` : '',
      summary.openCommentsCount > 0 ? `${summary.openCommentsCount} ${summary.openCommentsCount === 1 ? 'note' : 'notes'}` : '',
      ...summary.meta
    ].filter(Boolean);

    const swallow = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    return (
      <article
        data-task-id={task.id}
        className={`glass-card task-card is-${status.tone} ${focused ? 'is-focused' : ''} ${summary.folderGone ? 'opacity-60' : settledLabel ? 'is-settled' : ''}`}
      >
        {/* The card is one big link, so a middle click or ⌘-click opens the task
            in a tab like anything else on the web. It is not draggable: the
            overlay covers the card, so a native link drag would start here and
            the board would drag a URL chip instead of the card itself. */}
        <a
          href={taskHref(task.id)}
          draggable={false}
          className="absolute inset-0 z-[1] rounded-[14px] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label={summary.openLabel}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            onSelect(task);
          }}
        />

        <h3 className="task-card-title">{task.title}</h3>

        <p className="task-card-status" title={statusTitle}>
          <span className="task-card-dot" aria-hidden />
          <span className="truncate">{status.text}</span>
        </p>

        <div className="task-card-meta">
          {summary.place && (
            <span
              className={`inline-flex items-center gap-1 min-w-0 ${summary.folderGone ? 'text-err-fg' : ''}`}
              title={summary.folderGone ? `Folder gone: ${task.cwd || summary.place}` : task.cwd || summary.place}
            >
              <Folder className="w-3 h-3 shrink-0 opacity-60" />
              <span className="truncate">{summary.place}</span>
            </span>
          )}
          <TrackerLinks links={trackerLinks(task.links)} />
          <span className="task-card-facts">{meta.join(' · ')}</span>
        </div>

        {/* Hover actions sit above the card's link and swallow the click, so
            pressing one does not also open the task. */}
        <div className="task-card-actions" onClick={swallow}>
          {summary.running ? (
            <Tooltip label="Stop" withArrow>
              <button type="button" className="task-card-act" aria-label={`Stop ${task.id}`} onClick={() => onStop(task.id)}>
                <Square className="w-3 h-3 fill-current" />
              </button>
            </Tooltip>
          ) : (
            !summary.waiting &&
            !summary.folderGone && (
              <Tooltip label={summary.runLabel} withArrow>
                <button type="button" className="task-card-act" aria-label={`${summary.runLabel} ${task.id}`} onClick={() => onRun(task.id)}>
                  <Play className="w-3 h-3 fill-current" />
                </button>
              </Tooltip>
            )
          )}
          <Tooltip label="Archive" withArrow>
            <button
              type="button"
              className="task-card-act"
              aria-label={`Archive ${task.id}`}
              onClick={() => {
                if (window.confirm(`Archive ${task.id}? It leaves the board and keeps everything — restore it from the archive.`)) {
                  onArchive(task.id);
                }
              }}
            >
              <Archive className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </div>
      </article>
    );
  }
);

TaskCard.displayName = 'TaskCard';
