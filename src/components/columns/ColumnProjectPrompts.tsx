import React, { useState } from 'react';
import { Select, Tooltip } from '@mantine/core';
import { FolderCog, X } from 'lucide-react';
import { ProjectFolder } from '../../../shared/types';
import { projectsWithColumnPrompt } from '../../../shared/board/projectColumnPrompts';
import { Chip, Surface } from '../ui';

/**
 * What one project adds to this column's prompt.
 *
 * The column's prompt above is the same for every repo; this is the place for
 * the rules that are not — "run npm test", "read AGENTS.md".
 */

interface ColumnProjectPromptsProps {
  columnId: string;
  columnPrompt: string;
  projects: ProjectFolder[];
  promptFor: (projectId: string, columnId: string) => string;
  onChange: (projectId: string, columnId: string, text: string) => void;
}

export const ColumnProjectPrompts: React.FC<ColumnProjectPromptsProps> = ({
  columnId,
  columnPrompt,
  projects,
  promptFor,
  onChange
}) => {
  const configured = projectsWithColumnPrompt(projects, columnId);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  const [shownColumn, setShownColumn] = useState(columnId);
  if (shownColumn !== columnId) {
    setShownColumn(columnId);
    setSelectedId(configured[0]?.id || projects[0]?.id);
  }

  const active = projects.find((project) => project.id === selectedId) || configured[0] || projects[0];

  return (
    <Surface level="s1" border="default" radius="lg" className="p-3.5 flex flex-col gap-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <FolderCog className="w-3.5 h-3.5 text-ink-3 shrink-0" />
        <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-2">
          Per-project instructions
        </span>
        <span className="text-[11.5px] text-ink-3">
          Appended to the prompt above, only for tasks in that project.
        </span>
      </div>

      {projects.length === 0 ? (
        <span className="text-[12px] text-ink-3">
          Add a project folder to the board to give it its own instructions for this column.
        </span>
      ) : (
        <>
          {!columnPrompt.trim() && (
            <span className="text-[11.5px] text-ink-3">
              This column has no prompt, so nothing runs on enter — these instructions are added to a
              prompt, they are not one on their own.
            </span>
          )}

          <Select
            size="xs"
            label="Project"
            value={active?.id || null}
            data={projects.map((project) => ({
              value: project.id,
              label: promptFor(project.id, columnId).trim() ? `${project.name} •` : project.name
            }))}
            onChange={(value) => setSelectedId(value || undefined)}
            searchable
            onFocus={(e) => e.currentTarget.select()}
            allowDeselect={false}
            className="max-w-[280px]"
          />

          {active && (
            <textarea
              rows={3}
              placeholder={`Extra instructions for ${active.name} in this column — {{title}} and {{prompt}} work here too.`}
              value={promptFor(active.id, columnId)}
              onChange={(e) => onChange(active.id, columnId, e.currentTarget.value)}
              spellCheck={false}
              className="w-full p-2.5 rounded-lg border border-line bg-code text-ink font-mono text-[12px] leading-[1.55] placeholder:text-ink-4 focus:outline-none focus:border-acc-bd resize-y"
            />
          )}

          {configured.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
              <span className="text-[10.5px] text-ink-3 font-mono uppercase tracking-wider">
                Configured:
              </span>
              {configured.map((project) => (
                <Chip
                  key={project.id}
                  tone={project.id === active?.id ? 'accent' : 'neutral'}
                  className="gap-1.5 pr-1"
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(project.id)}
                    className="bg-transparent border-0 p-0 text-inherit font-inherit cursor-pointer"
                  >
                    {project.name}
                  </button>
                  <Tooltip label={`Clear ${project.name}'s instructions`} withArrow>
                    <button
                      type="button"
                      onClick={() => onChange(project.id, columnId, '')}
                      aria-label={`Clear ${project.name}'s instructions`}
                      className="inline-flex items-center justify-center rounded-full hover:text-err-fg bg-transparent border-0 p-0 cursor-pointer text-ink-3"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </Tooltip>
                </Chip>
              ))}
            </div>
          )}
        </>
      )}
    </Surface>
  );
};
