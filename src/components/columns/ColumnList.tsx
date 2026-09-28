import React from 'react';
import { Button, Group, ScrollArea, Stack, Text, UnstyledButton } from '@mantine/core';
import { Plus, Zap } from 'lucide-react';
import { BoardColumn } from '../../../shared/types';
import { columnRunsOnDrop } from '../../../shared/board/columns';
import { columnSummaryLine } from '../../../shared/board/columnDraft';

/** The board's columns in board order — pick one to edit, or add another. */

interface ColumnListProps {
  columns: BoardColumn[];
  selectedId: string | undefined;
  taskCounts: Record<string, number>;
  onSelect: (id: string) => void;
  onAdd: () => void;
}

export const ColumnList: React.FC<ColumnListProps> = ({ columns, selectedId, taskCounts, onSelect, onAdd }) => (
  <div className="md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-line flex flex-col">
    <ScrollArea className="flex-1 max-h-40 md:max-h-none">
      <Stack gap={4} p="xs">
        {columns.map((column) => {
          const active = column.id === selectedId;
          return (
            <UnstyledButton
              key={column.id}
              onClick={() => onSelect(column.id)}
              className={`rounded-md px-2 py-1.5 text-left transition-colors ${
                active ? 'bg-slate-800/90' : 'hover:bg-slate-900/80'
              }`}
            >
              <Group justify="space-between" wrap="nowrap" gap={6}>
                <div className="min-w-0">
                  <Text size="sm" className={`truncate ${active ? 'text-ink' : 'text-slate-300'}`}>
                    {column.title || 'Untitled'}
                  </Text>
                  <Text size="10px" c="dimmed" className="font-mono">
                    {columnSummaryLine(column, taskCounts[column.id] || 0)}
                  </Text>
                </div>
                {columnRunsOnDrop(column) && <Zap className="w-3 h-3 text-ink-3 shrink-0" />}
              </Group>
            </UnstyledButton>
          );
        })}
      </Stack>
    </ScrollArea>
    <div className="p-2 border-t border-line">
      <Button size="xs" variant="subtle" color="gray" fullWidth leftSection={<Plus className="w-3.5 h-3.5" />} onClick={onAdd}>
        Add column
      </Button>
    </div>
  </div>
);
