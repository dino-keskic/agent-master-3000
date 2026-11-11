import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CornerDownLeft, Plus, Search } from 'lucide-react';
import { BoardColumn, BoardTask, TaskRunState } from '../../../shared/types';
import {
  PaletteResult,
  flattenSections,
  moveSelection,
  searchPalette
} from '../../../shared/palette/search';
import { PALETTE_ACTIONS, PaletteHandlers } from './paletteCommands';
import './palette.css';

/**
 * The command palette: one field over the board that finds a task, runs a
 * command, or makes what was typed into a new task.
 *
 * What it lists and in what order is `shared/palette/search.ts`; this draws
 * the answer and says what Enter means on each kind of row. It is mounted only
 * while open, so every opening starts from an empty field.
 */

interface CommandPaletteProps extends PaletteHandlers {
  tasks: BoardTask[];
  columns: BoardColumn[];
  /** Where a task created from here lands, for the row's wording. */
  createHint: string;
  onClose: () => void;
  onOpenTask: (task: BoardTask) => void;
  /** ⌘Enter: open it next to what is already open. */
  onOpenTaskBeside: (taskId: string) => void;
  onCreateTask: (text: string) => void;
}

const STATE_DOT: Record<TaskRunState, string> = {
  idle: 'bg-ink-4',
  running: 'bg-run',
  awaiting_input: 'bg-wait',
  error: 'bg-err'
};

const STATE_WORD: Partial<Record<TaskRunState, string>> = {
  running: 'Running',
  awaiting_input: 'Waiting for you',
  error: 'Error'
};

function taskSubtitle(result: Extract<PaletteResult, { kind: 'task' }>): string {
  const { task } = result;
  return [task.taskId, ...task.refs, task.columnTitle, task.place, STATE_WORD[task.runState]]
    .filter(Boolean)
    .join(' · ');
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  tasks,
  columns,
  createHint,
  onClose,
  onOpenTask,
  onOpenTaskBeside,
  onCreateTask,
  ...handlers
}) => {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const sections = useMemo(() => searchPalette(query, tasks, columns, PALETTE_ACTIONS), [query, tasks, columns]);
  const rows = useMemo(() => flattenSections(sections), [sections]);
  // A task can leave the board while the palette is up; the highlight follows the list.
  const active = Math.min(index, Math.max(rows.length - 1, 0));

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, query]);

  const run = (result: PaletteResult | undefined, beside: boolean) => {
    if (!result) return;
    onClose();
    if (result.kind === 'create') return onCreateTask(result.text);
    if (result.kind === 'command') {
      return PALETTE_ACTIONS.find((action) => action.id === result.command.id)?.run(handlers);
    }
    const task = tasks.find((candidate) => candidate.id === result.task.taskId);
    if (!task) return;
    if (beside) onOpenTaskBeside(task.id);
    else onOpenTask(task);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex(moveSelection(active, event.key === 'ArrowDown' ? 1 : -1, rows.length));
    } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      run(rows[active], event.metaKey || event.ctrlKey);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  // Where each section's first row sits in the flat list the arrows walk.
  const offsets = sections.map((_, i) => sections.slice(0, i).reduce((sum, s) => sum + s.results.length, 0));

  return createPortal(
    <div className="palette-scrim" onMouseDown={onClose}>
      <div
        className="palette glass-chrome"
        role="dialog"
        aria-modal="true"
        aria-label="Search the board"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="palette-field">
          <Search className="w-5 h-5 shrink-0" />
          <input
            autoFocus
            className="palette-input"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setIndex(0);
            }}
            placeholder="Search tasks, tickets and commands — or type a new task"
            aria-label="Search tasks, tickets and commands"
            spellCheck={false}
            autoComplete="off"
          />
          <span className="kbd">esc</span>
        </div>

        <div className="palette-list" ref={listRef} role="listbox">
          {sections.map((section, sectionIndex) => (
            <div key={section.label}>
              <div className="palette-label">{section.label}</div>
              {section.results.map((result, rowIndex) => {
                const at = offsets[sectionIndex]! + rowIndex;
                const isOn = at === active;
                return (
                  <button
                    key={result.id}
                    type="button"
                    role="option"
                    aria-selected={isOn}
                    data-active={isOn}
                    className={`palette-row${isOn ? ' is-on' : ''}`}
                    onMouseMove={() => setIndex(at)}
                    onClick={(event) => run(result, event.metaKey || event.ctrlKey)}
                  >
                    <PaletteRow result={result} createHint={createHint} />
                    {isOn && <CornerDownLeft className="w-3.5 h-3.5 shrink-0 text-ink-3" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="palette-foot">
          <span className="inline-flex items-center gap-1.5"><span className="kbd">↑</span><span className="kbd">↓</span> move</span>
          <span className="inline-flex items-center gap-1.5"><span className="kbd">↵</span> open</span>
          <span className="inline-flex items-center gap-1.5"><span className="kbd">⌘</span><span className="kbd">↵</span> open beside</span>
          <span className="ml-auto inline-flex items-center gap-1.5"><span className="kbd">⌘</span><span className="kbd">K</span> toggle</span>
        </div>
      </div>
    </div>,
    document.body
  );
};

const PaletteRow: React.FC<{ result: PaletteResult; createHint: string }> = ({ result, createHint }) => {
  if (result.kind === 'task') {
    return (
      <>
        <span className="palette-row-icon">
          <span className={`w-2 h-2 rounded-full ${STATE_DOT[result.task.runState]}`} />
        </span>
        <span className="palette-row-main">
          <span className="palette-row-title">{result.task.title}</span>
          <span className="palette-row-sub">{taskSubtitle(result)}</span>
        </span>
      </>
    );
  }
  if (result.kind === 'command') {
    const Icon = PALETTE_ACTIONS.find((action) => action.id === result.command.id)?.Icon || Search;
    return (
      <>
        <span className="palette-row-icon"><Icon className="w-4 h-4" /></span>
        <span className="palette-row-main">
          <span className="palette-row-title">{result.command.title}</span>
        </span>
      </>
    );
  }
  return (
    <>
      <span className="palette-row-icon"><Plus className="w-4 h-4" /></span>
      <span className="palette-row-main">
        <span className="palette-row-title">New task: “{result.text}”</span>
        <span className="palette-row-sub">{createHint}</span>
      </span>
    </>
  );
};
