import React from 'react';
import { Group, Select } from '@mantine/core';
import { OpenCodeAgent, OpenCodeModel } from '../../../shared/sessions/types';
import { BoardColumn, PermissionMode } from '../../../shared/types';
import { thinkingLevelOptions } from '../../../shared/format';
import { PERMISSION_MODES } from '../../../shared/agent/permissions';
import { useModelOptions } from '../../app/modelOptions';

/**
 * What a column imposes on a task that enters it.
 *
 * Every setting is optional: "keep current" leaves the task's own choice
 * alone, which is why each list starts with one and stores `undefined`.
 */

const KEEP = '__keep__';

function keepValue(value?: string): string {
  return value || KEEP;
}

function fromKeep(value: string | null): string | undefined {
  if (!value || value === KEEP) return undefined;
  return value;
}

interface ColumnDefaultsProps {
  column: BoardColumn;
  models: OpenCodeModel[];
  agents: OpenCodeAgent[];
  onPatch: (updates: Partial<BoardColumn>) => void;
}

export const ColumnDefaults: React.FC<ColumnDefaultsProps> = ({ column, models, agents, onPatch }) => {
  // A column that pins a model offers that model's agents and levels; one that
  // keeps the task's own model can only speak for the board default.
  const options = useModelOptions(column.model);

  return (
  <Group gap="xs" wrap="wrap">
    <Select
      size="xs"
      label="Model"
      value={keepValue(column.model)}
      data={[{ value: KEEP, label: 'Keep current model' }, ...models.map((m) => ({ value: m.id, label: m.scope ? `${m.name} (${m.scope})` : m.name }))]}
      onChange={(val) => onPatch({ model: fromKeep(val) })}
      searchable
      // Mantine seeds the search box with the current label; without this the
      // caret lands mid-string and typing corrupts it into an unmatchable value.
      onFocus={(e) => e.currentTarget.select()}
      allowDeselect={false}
      className="min-w-[160px] flex-1"
    />
    <Select
      size="xs"
      label="Agent"
      value={keepValue(column.agent)}
      data={[{ value: KEEP, label: 'Keep current agent' }, ...(options.known ? options.agents : agents).map((a) => ({ value: a.name, label: a.name }))]}
      onChange={(val) => onPatch({ agent: fromKeep(val) })}
      allowDeselect={false}
      className="min-w-[140px] flex-1"
    />
    <Select
      size="xs"
      label="Thinking"
      value={keepValue(column.thinkingLevel)}
      data={[{ value: KEEP, label: 'Keep current thinking' }, ...thinkingLevelOptions(options.effortLevels)]}
      onChange={(val) => onPatch({ thinkingLevel: fromKeep(val) })}
      allowDeselect={false}
      className="min-w-[140px] flex-1"
    />
    <Select
      size="xs"
      label="Permissions"
      value={keepValue(column.permissionMode)}
      data={[{ value: KEEP, label: 'Keep current permissions' }, ...PERMISSION_MODES.map((m) => ({ value: m.value, label: m.label }))]}
      onChange={(val) => onPatch({ permissionMode: fromKeep(val) as PermissionMode | undefined })}
      allowDeselect={false}
      className="min-w-[140px] flex-1"
    />
  </Group>
  );
};
