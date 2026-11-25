import React from 'react';
import { ScrollArea, Tooltip } from '@mantine/core';
import { ChevronDown, ChevronUp, Sliders, Terminal, Trash2 } from 'lucide-react';
import { OpenCodeAgent, OpenCodeModel } from '../../../shared/sessions/types';
import { Button, Surface } from '../ui';
import { ColumnDraft } from './useColumnDraft';
import { ColumnBehavior } from './ColumnBehavior';
import { ColumnDefaults } from './ColumnDefaults';
import { ColumnProjectPrompts } from './ColumnProjectPrompts';
import { ProjectPromptsDraft } from './useProjectPrompts';

/** Everything about the one column that is selected. */

interface ColumnFormProps {
  draft: ColumnDraft;
  projectPrompts: ProjectPromptsDraft;
  models: OpenCodeModel[];
  agents: OpenCodeAgent[];
  taskCounts: Record<string, number>;
}

const INPUT_CLASS =
  'w-full h-8 px-2.5 rounded-lg border border-line bg-surface-2 text-ink text-[12.5px] placeholder:text-ink-4 focus:outline-none focus:border-acc-bd transition-colors';

export const ColumnForm: React.FC<ColumnFormProps> = ({
  draft,
  projectPrompts,
  models,
  agents,
  taskCounts
}) => {
  const { selected, selectedIndex, columns, patch } = draft;
  if (!selected) return null;
  const movedTasks = taskCounts[selected.id];

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="flex flex-col gap-3.5 p-4">
        <Surface level="s1" border="default" radius="lg" className="p-3.5 flex flex-col gap-3">
          <div className="flex items-end justify-between gap-2">
            <label className="flex flex-col gap-1 flex-1 min-w-0">
              <span className="text-[11px] font-medium text-ink-3">Column title</span>
              <input
                type="text"
                value={selected.title}
                onChange={(e) => patch({ title: e.currentTarget.value })}
                placeholder="e.g. In Progress, Code Review"
                className={INPUT_CLASS}
              />
            </label>
            <div className="flex items-center gap-1 pb-0.5 shrink-0">
              <Tooltip label="Move column left" withArrow>
                <button
                  type="button"
                  className="icon-btn"
                  disabled={selectedIndex === 0}
                  onClick={() => draft.move(selectedIndex, -1)}
                  aria-label="Move up"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
              </Tooltip>
              <Tooltip label="Move column right" withArrow>
                <button
                  type="button"
                  className="icon-btn"
                  disabled={selectedIndex === columns.length - 1}
                  onClick={() => draft.move(selectedIndex, 1)}
                  aria-label="Move down"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </Tooltip>
              <Tooltip
                label={
                  columns.length <= 1
                    ? 'Keep at least one column'
                    : movedTasks
                      ? `${movedTasks} task(s) will move to the first remaining column`
                      : 'Delete column'
                }
                withArrow
              >
                <Button
                  size="icon-sm"
                  variant="danger"
                  disabled={columns.length <= 1}
                  onClick={() => draft.remove(selectedIndex)}
                  aria-label="Delete column"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </Tooltip>
            </div>
          </div>

          <div className="border-t border-hairline pt-2.5 flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-ink-3" />
              <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                Stage defaults
              </span>
            </div>
            <ColumnDefaults column={selected} models={models} agents={agents} onPatch={patch} />
          </div>
        </Surface>

        <Surface level="s1" border="default" radius="lg" className="p-3.5 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-acc-fg" />
              <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-2">
                On-enter prompt
              </span>
            </div>
            <span className="text-[11px] text-ink-4 font-mono">
              Supports {'{{title}}'} &amp; {'{{prompt}}'}
            </span>
          </div>
          <p className="m-0 text-[11.5px] text-ink-3">
            Sent when a task enters this column (if auto-run is enabled) or when you press Run on a card here.
          </p>
          <textarea
            value={selected.prompt}
            onChange={(e) => patch({ prompt: e.currentTarget.value })}
            rows={6}
            spellCheck={false}
            placeholder="Leave empty for a move-only stage (like Backlog or Done)…"
            className="w-full p-2.5 rounded-lg border border-line bg-code text-ink font-mono text-[12px] leading-[1.55] placeholder:text-ink-4 focus:outline-none focus:border-acc-bd resize-y"
          />
        </Surface>

        <ColumnProjectPrompts
          columnId={selected.id}
          columnPrompt={selected.prompt}
          projects={projectPrompts.projects}
          promptFor={projectPrompts.promptFor}
          onChange={projectPrompts.setPrompt}
        />

        <ColumnBehavior column={selected} onPatch={patch} />
      </div>
    </ScrollArea>
  );
};
