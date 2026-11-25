import React from 'react';
import { Modal } from '@mantine/core';
import { Columns3 } from 'lucide-react';
import { OpenCodeAgent, OpenCodeModel } from '../../../shared/sessions/types';
import { BoardColumn } from '../../../shared/types';
import { Button, Chip, EmptyState } from '../ui';
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
    void projectPrompts.save(cleaned.map((column) => column.id));
    onClose();
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <Columns3 className="w-4 h-4 text-accent" />
          <span className="text-[14px] font-semibold text-ink">Board columns</span>
          <Chip className="font-mono">{draft.columns.length} stages</Chip>
        </div>
      }
      size="xl"
      styles={{
        content: { backgroundColor: 'var(--glass-pane)', color: 'rgb(var(--c-ink))' },
        header: { backgroundColor: 'rgb(var(--c-surface))', borderBottom: '1px solid rgb(var(--c-line))' },
        body: { backgroundColor: 'transparent', padding: 0 }
      }}
    >
      <div className="flex flex-col md:flex-row h-[min(680px,78vh)] min-h-0 overflow-hidden">
        <ColumnList
          columns={draft.columns}
          selectedId={draft.selectedId}
          taskCounts={taskCounts}
          onSelect={draft.select}
          onAdd={draft.add}
        />

        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {draft.selected ? (
            <ColumnForm
              draft={draft}
              projectPrompts={projectPrompts}
              models={models}
              agents={agents}
              taskCounts={taskCounts}
            />
          ) : (
            <div className="p-6 flex-1 flex items-center justify-center">
              <EmptyState
                icon={<Columns3 className="w-4 h-4" />}
                title="Select a column"
                description="Choose a column on the left to configure its prompt, defaults, and stage behavior."
              />
            </div>
          )}

          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-line bg-surface shrink-0">
            <Button size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={handleSave} disabled={!draft.canSave}>
              Save columns
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
