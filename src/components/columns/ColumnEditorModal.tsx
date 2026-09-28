import React from 'react';
import { Button, Group, Modal, Paper, Text } from '@mantine/core';
import { Columns3 } from 'lucide-react';
import { OpenCodeAgent, OpenCodeModel } from '../../../shared/sessions/types';
import { BoardColumn } from '../../../shared/types';
import { useColumnDraft } from './useColumnDraft';
import { useProjectPrompts } from './useProjectPrompts';
import { ColumnForm } from './ColumnForm';
import { ColumnList } from './ColumnList';

/**
 * Editing the board's columns: the list on the left, the selected one on the right.
 *
 * Two drafts, saved together by the one button: the columns themselves, which
 * go through the settings write like every other board setting, and the extra
 * instructions each project adds to a column, which hang off the projects.
 */

interface ColumnEditorModalProps {
  opened: boolean;
  columns: BoardColumn[];
  models: OpenCodeModel[];
  agents: OpenCodeAgent[];
  taskCounts: Record<string, number>;
  onClose: () => void;
  onSave: (columns: BoardColumn[]) => void | Promise<void>;
}

export const ColumnEditorModal: React.FC<ColumnEditorModalProps> = ({
  opened,
  columns,
  models,
  agents,
  taskCounts,
  onClose,
  onSave
}) => {
  const draft = useColumnDraft(columns, opened);
  const projectPrompts = useProjectPrompts(opened);

  const handleSave = () => {
    const cleaned = draft.cleaned();
    void onSave(cleaned);
    // After the columns, and with the surviving ids, so instructions for a
    // column the user just deleted are dropped rather than left to be
    // inherited by the next column that slugs to the same id.
    void projectPrompts.save(cleaned.map((column) => column.id));
    onClose();
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <Columns3 className="w-4 h-4 text-ink-2" />
          <Text fw={600}>Board columns</Text>
        </Group>
      }
      size="xl"
      styles={{
        content: { backgroundColor: 'rgb(var(--c-canvas))', color: 'rgb(var(--c-ink))' },
        header: { backgroundColor: 'rgb(var(--c-surface-3))', borderBottom: '1px solid rgb(var(--c-line) / 0.7)' },
        body: { backgroundColor: 'rgb(var(--c-canvas))', padding: 0 }
      }}
    >
      <div className="flex flex-col md:flex-row min-h-[460px]">
        <ColumnList
          columns={draft.columns}
          selectedId={draft.selectedId}
          taskCounts={taskCounts}
          onSelect={draft.select}
          onAdd={draft.add}
        />

        <div className="flex-1 flex flex-col min-w-0">
          {draft.selected ? (
            <ColumnForm draft={draft} projectPrompts={projectPrompts} models={models} agents={agents} taskCounts={taskCounts} />
          ) : (
            <Paper p="xl" bg="transparent">
              <Text size="sm" c="dimmed">Select a column to edit.</Text>
            </Paper>
          )}

          <Group justify="flex-end" gap="xs" p="sm" className="border-t border-line">
            <Button size="xs" variant="subtle" color="gray" onClick={onClose}>
              Cancel
            </Button>
            <Button size="xs" color="accent" onClick={handleSave} disabled={!draft.canSave}>
              Save columns
            </Button>
          </Group>
        </div>
      </div>
    </Modal>
  );
};
