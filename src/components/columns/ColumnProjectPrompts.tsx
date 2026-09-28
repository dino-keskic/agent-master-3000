import React, { useState } from 'react';
import { ActionIcon, Group, Select, Text, Textarea, Tooltip, UnstyledButton } from '@mantine/core';
import { FolderCog, X } from 'lucide-react';
import { ProjectFolder } from '../../../shared/types';
import { projectsWithColumnPrompt } from '../../../shared/board/projectColumnPrompts';

/**
 * What one project adds to this column's prompt.
 *
 * The column's prompt above is the same for every repo; this is the place for
 * the rules that are not — "run npm test", "read AGENTS.md". One project is
 * edited at a time, and the row of chips underneath says which of the others
 * already have something, so the answer to "where did that instruction come
 * from" is on screen rather than a click away per project.
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

  // Switching columns lands on a project that already has instructions for the
  // new one — corrected during render, so no frame shows the old column's
  // project against the new column's text. One set per column change, so it
  // terminates.
  const [shownColumn, setShownColumn] = useState(columnId);
  if (shownColumn !== columnId) {
    setShownColumn(columnId);
    setSelectedId(configured[0]?.id || projects[0]?.id);
  }

  const active = projects.find((project) => project.id === selectedId) || configured[0] || projects[0];

  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3 flex flex-col gap-2">
      <Group gap={8} wrap="nowrap" align="center">
        <FolderCog className="w-4 h-4 text-ink-3 shrink-0" />
        <Text size="sm" fw={600} className="text-ink">Per-project instructions</Text>
        <Text size="xs" className="text-ink-3">
          Appended to the prompt above, only for tasks in that project.
        </Text>
      </Group>

      {projects.length === 0 ? (
        <Text size="xs" className="text-ink-3">
          Add a project folder to the board to give it its own instructions for this column.
        </Text>
      ) : (
        <>
          {!columnPrompt.trim() && (
            <Text size="xs" className="text-ink-3">
              This column has no prompt, so nothing runs on enter — these instructions are added to a
              prompt, they are not one on their own.
            </Text>
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
            // Mantine seeds the search box with the current label; without this
            // the caret lands mid-string and typing corrupts it.
            onFocus={(e) => e.currentTarget.select()}
            allowDeselect={false}
            className="max-w-[280px]"
          />

          {active && (
            <Textarea
              size="sm"
              minRows={3}
              autosize
              maxRows={10}
              placeholder={`Extra instructions for ${active.name} in this column — {{title}} and {{prompt}} work here too.`}
              value={promptFor(active.id, columnId)}
              onChange={(e) => onChange(active.id, columnId, e.currentTarget.value)}
            />
          )}

          {configured.length > 0 && (
            <Group gap={6} wrap="wrap">
              <Text size="10px" className="text-ink-3 font-mono uppercase tracking-wide">
                Has instructions
              </Text>
              {configured.map((project) => (
                <div
                  key={project.id}
                  className={`flex items-center gap-1 rounded-full border pl-2 pr-1 py-0.5 ${
                    project.id === active?.id ? 'border-line-strong bg-surface-3' : 'border-line bg-surface'
                  }`}
                >
                  <UnstyledButton onClick={() => setSelectedId(project.id)}>
                    <Text size="xs" className="text-ink-2">{project.name}</Text>
                  </UnstyledButton>
                  <Tooltip label={`Clear ${project.name}'s instructions`} withArrow>
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      size="xs"
                      radius="xl"
                      onClick={() => onChange(project.id, columnId, '')}
                    >
                      <X className="w-3 h-3" />
                    </ActionIcon>
                  </Tooltip>
                </div>
              ))}
            </Group>
          )}
        </>
      )}
    </div>
  );
};
