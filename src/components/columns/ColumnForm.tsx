import React from 'react';
import { ActionIcon, Group, ScrollArea, Stack, Textarea, TextInput, Tooltip } from '@mantine/core';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { OpenCodeAgent, OpenCodeModel } from '../../../shared/sessions/types';
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

export const ColumnForm: React.FC<ColumnFormProps> = ({ draft, projectPrompts, models, agents, taskCounts }) => {
  const { selected, selectedIndex, columns, patch } = draft;
  if (!selected) return null;
  const movedTasks = taskCounts[selected.id];

  return (
    <ScrollArea className="flex-1">
      <Stack gap="sm" p="md">
        <Group justify="space-between" wrap="nowrap" align="flex-end">
          <TextInput
            label="Title"
            size="sm"
            value={selected.title}
            onChange={(e) => patch({ title: e.currentTarget.value })}
            className="flex-1"
          />
          <Group gap={4} wrap="nowrap" className="pb-0.5">
            <Tooltip label="Move up" withArrow>
              <ActionIcon variant="subtle" color="gray" size="sm" disabled={selectedIndex === 0} onClick={() => draft.move(selectedIndex, -1)}>
                <ChevronUp className="w-4 h-4" />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Move down" withArrow>
              <ActionIcon variant="subtle" color="gray" size="sm" disabled={selectedIndex === columns.length - 1} onClick={() => draft.move(selectedIndex, 1)}>
                <ChevronDown className="w-4 h-4" />
              </ActionIcon>
            </Tooltip>
            <Tooltip
              label={columns.length <= 1
                ? 'Keep at least one column'
                : (movedTasks ? `${movedTasks} task(s) will move to the first remaining column` : 'Delete column')}
              withArrow
            >
              <ActionIcon variant="subtle" color="red" size="sm" disabled={columns.length <= 1} onClick={() => draft.remove(selectedIndex)}>
                <Trash2 className="w-3.5 h-3.5" />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        <ColumnDefaults column={selected} models={models} agents={agents} onPatch={patch} />

        <Textarea
          size="sm"
          label="On-enter prompt"
          description="Use {{title}} and {{prompt}}. Empty means move-only unless you hit Run."
          minRows={8}
          autosize
          maxRows={16}
          value={selected.prompt}
          onChange={(e) => patch({ prompt: e.currentTarget.value })}
        />

        <ColumnProjectPrompts
          columnId={selected.id}
          columnPrompt={selected.prompt}
          projects={projectPrompts.projects}
          promptFor={projectPrompts.promptFor}
          onChange={projectPrompts.setPrompt}
        />

        <ColumnBehavior column={selected} onPatch={patch} />
      </Stack>
    </ScrollArea>
  );
};
