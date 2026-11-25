import React from 'react';
import { Tooltip } from '@mantine/core';
import { ArrowLeft, Check, Clock, Columns3, ExternalLink, X } from 'lucide-react';
import { BoardColumn, TaskRunState } from '../../../shared/types';
import { taskHref } from '../../../shared/ids';
import { Chip, InlineSelect } from '../ui';

interface DrawerTitleBarProps {
  /** Left out for the manager, which is not a card and has no id worth showing. */
  taskId?: string;
  columns?: BoardColumn[];
  columnId?: string;
  onMoveColumn?: (columnId: string) => void;
  /** Live state of the session on screen, surfaced when non-idle. */
  runState?: TaskRunState;
  /** Formatted elapsed time for the active turn while `runState === 'running'`. */
  runningDurationLabel?: string;
  /** Formatted duration from the latest user prompt to agent completion. */
  lastTurnDurationLabel?: string;
  /** Formatted cumulative active duration across the session. */
  totalDurationLabel?: string;
  title: string;
  editing: boolean;
  draftTitle: string;
  onDraftTitleChange: (value: string) => void;
  onStartEditing: () => void;
  onCancelEditing: () => void;
  onSaveTitle: () => void;
  /** Panel controls: open beside, remote access, the details toggle. */
  controls?: React.ReactNode;
  /** Shown on narrow/mobile workspaces when the left WorkRail is hidden. */
  showBack?: boolean;
  onBack?: () => void;
  /** Only shown in split mode; in single-pane view the left WorkRail already owns Back/Esc. */
  showClose?: boolean;
  onClose: () => void;
  closeLabel: string;
}

function durationSummary(lastTurn?: string, total?: string): { text: string; tooltip: string } | null {
  if (!lastTurn && !total) return null;
  if (lastTurn && total && lastTurn !== total) {
    return {
      text: `${lastTurn} · total ${total}`,
      tooltip: `From last prompt: ${lastTurn} · Whole session: ${total}`
    };
  }
  const single = lastTurn || total!;
  return {
    text: single,
    tooltip: lastTurn
      ? `Completed ${lastTurn} after last prompt${total ? ` · Whole session: ${total}` : ''}`
      : `Whole session run time: ${total}`
  };
}

/**
 * Slim panel header: task id, interactive column picker, click-to-edit title,
 * live status/timing pills, and panel controls. Stacks into two tight rows on
 * narrow phone screens so titles and controls never crush each other.
 */
export const DrawerTitleBar: React.FC<DrawerTitleBarProps> = ({
  taskId,
  columns,
  columnId,
  onMoveColumn,
  runState,
  runningDurationLabel,
  lastTurnDurationLabel,
  totalDurationLabel,
  title,
  editing,
  draftTitle,
  onDraftTitleChange,
  onStartEditing,
  onCancelEditing,
  onSaveTitle,
  controls,
  showBack = false,
  onBack,
  showClose = false,
  onClose,
  closeLabel
}) => {
  const finishedTiming = runState !== 'running' ? durationSummary(lastTurnDurationLabel, totalDurationLabel) : null;
  const runningTooltip =
    runningDurationLabel && totalDurationLabel && runningDurationLabel !== totalDurationLabel
      ? `Current turn ${runningDurationLabel} · Whole session ${totalDurationLabel}`
      : undefined;
  const hasMobileMeta = !!(taskId || (columns && columnId && onMoveColumn) || runState !== 'idle' || finishedTiming);

  const statusChip = (compact: boolean) => {
    if (runState === 'awaiting_input') {
      return <Chip tone="wait" className="shrink-0">waiting for you</Chip>;
    }
    if (runState === 'running') {
      const pill = (
        <Chip tone="run" className="shrink-0 tabular-nums">
          running{runningDurationLabel ? ` · ${runningDurationLabel}` : ''}
        </Chip>
      );
      return runningTooltip && !compact ? (
        <Tooltip label={runningTooltip} withArrow>{pill}</Tooltip>
      ) : pill;
    }
    if (runState === 'error') {
      return <Chip tone="err" className="shrink-0">error</Chip>;
    }
    return null;
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 w-full min-w-0">
      <div className="flex items-center gap-1.5 sm:gap-2 flex-1 min-w-0">
        {showBack && onBack && (
          <Tooltip label="Back to the board" withArrow>
            <button
              type="button"
              className="icon-btn w-8 h-8 sm:w-7 sm:h-7 shrink-0 -ml-1"
              aria-label="Back to the board"
              onClick={onBack}
            >
              <ArrowLeft className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
            </button>
          </Tooltip>
        )}

        {taskId && (
          <span className="hidden sm:inline font-mono text-[11.5px] font-semibold text-ink-3 shrink-0">
            {taskId}
          </span>
        )}

        {columns && columnId && onMoveColumn && (
          <div className="hidden sm:flex items-center gap-2 shrink-0">
            {taskId && <span className="text-line-strong text-xs select-none">/</span>}
            <InlineSelect
              label="Column"
              icon={<Columns3 className="w-3 h-3" />}
              value={columnId}
              options={columns.map((c) => ({ value: c.id, label: c.title }))}
              onChange={(val) => val !== columnId && onMoveColumn(val)}
              title="Move this task to another column"
            />
          </div>
        )}

        {editing ? (
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <input
              type="text"
              value={draftTitle}
              onChange={(e) => onDraftTitleChange(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSaveTitle();
                if (e.key === 'Escape') {
                  e.preventDefault();
                  onCancelEditing();
                }
              }}
              autoFocus
              className="flex-1 min-w-0 h-8 sm:h-7 px-2.5 rounded-lg border border-acc-bd bg-surface-2 text-ink text-[16px] sm:text-[13.5px] font-semibold focus:outline-none"
            />
            <button type="button" className="icon-btn" aria-label="Save title" onClick={onSaveTitle}>
              <Check className="w-3.5 h-3.5 text-run-fg" />
            </button>
            <button type="button" className="icon-btn" aria-label="Cancel editing" onClick={onCancelEditing}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <h2
            className="m-0 flex-1 min-w-0 text-[14px] sm:text-[13.5px] font-semibold leading-[1.35] text-ink truncate cursor-text hover:text-acc-fg transition-colors"
            onClick={onStartEditing}
            title="Click to edit title"
          >
            {title}
          </h2>
        )}

        <div className="hidden sm:flex items-center gap-1.5 shrink-0">
          {statusChip(false)}
          {finishedTiming && (
            <Tooltip label={finishedTiming.tooltip} withArrow>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-s3 border border-hairline text-[11px] text-ink-3 tabular-nums">
                <Clock className="w-3 h-3 shrink-0 text-ink-4" />
                {finishedTiming.text}
              </span>
            </Tooltip>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {controls}
          {taskId && (
            <Tooltip label="Open this task in a new tab" withArrow>
              <button
                type="button"
                className="icon-btn hidden sm:inline-flex"
                aria-label="Open in a new tab"
                onClick={() => window.open(taskHref(taskId), '_blank', 'noopener')}
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          )}
          {showClose && (
            <Tooltip label={closeLabel} withArrow>
              <button type="button" className="icon-btn w-8 h-8 sm:w-7 sm:h-7" aria-label={closeLabel} onClick={onClose}>
                <X className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {hasMobileMeta && (
        <div
          className={`flex sm:hidden items-center gap-1.5 min-w-0 overflow-x-auto no-scrollbar pb-0.5 ${
            showBack ? 'pl-8' : ''
          }`}
        >
          {taskId && (
            <span className="font-mono text-[11px] font-semibold text-ink-3 shrink-0">{taskId}</span>
          )}
          {columns && columnId && onMoveColumn && (
            <InlineSelect
              label="Column"
              icon={<Columns3 className="w-3 h-3" />}
              value={columnId}
              options={columns.map((c) => ({ value: c.id, label: c.title }))}
              onChange={(val) => val !== columnId && onMoveColumn(val)}
              title="Move this task to another column"
            />
          )}
          {statusChip(true)}
          {finishedTiming && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-s3 border border-hairline text-[11px] text-ink-3 tabular-nums shrink-0">
              <Clock className="w-2.5 h-2.5 shrink-0 text-ink-4" />
              {finishedTiming.text}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
