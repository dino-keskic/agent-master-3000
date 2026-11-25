import React from 'react';
import { ScrollArea } from '@mantine/core';
import { Plus, Zap } from 'lucide-react';
import { BoardColumn } from '../../../shared/types';
import { columnRunsOnDrop } from '../../../shared/board/columns';
import { columnSummaryLine } from '../../../shared/board/columnDraft';
import { Button, Chip } from '../ui';

/** The board's columns in board order — pick one to edit, or add another. */

interface ColumnListProps {
  columns: BoardColumn[];
  selectedId: string | undefined;
  taskCounts: Record<string, number>;
  onSelect: (id: string) => void;
  onAdd: () => void;
}

export const ColumnList: React.FC<ColumnListProps> = ({
  columns,
  selectedId,
  taskCounts,
  onSelect,
  onAdd
}) => (
  <div className="md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-line bg-surface/50 flex flex-col min-h-0">
    <ScrollArea className="flex-1 max-h-44 md:max-h-none">
      <div className="flex flex-col gap-1.5 p-2.5">
        {columns.map((column, index) => {
          const active = column.id === selectedId;
          const runs = columnRunsOnDrop(column);
          return (
            <button
              key={column.id}
              type="button"
              onClick={() => onSelect(column.id)}
              className={`w-full text-left rounded-xl p-2.5 transition-all duration-150 cursor-pointer border flex items-center justify-between gap-2 ${
                active
                  ? 'bg-acc-bg border-acc-bd shadow-card'
                  : 'bg-surface border-line hover:border-line-strong hover:bg-s3h'
              }`}
            >
              <div className="flex items-start gap-2 min-w-0">
                <span className="font-mono text-[11px] text-ink-4 mt-0.5 tabular-nums shrink-0">
                  {index + 1}.
                </span>
                <div className="min-w-0 flex flex-col gap-0.5">
                  <span className="text-[12.5px] font-semibold text-ink truncate">
                    {column.title || 'Untitled'}
                  </span>
                  <span className="font-mono text-[11px] text-ink-3 truncate">
                    {columnSummaryLine(column, taskCounts[column.id] || 0)}
                  </span>
                </div>
              </div>
              {runs && (
                <Chip tone="run" className="shrink-0" title="Runs prompt on drop">
                  <Zap className="w-2.5 h-2.5" />
                </Chip>
              )}
            </button>
          );
        })}
      </div>
    </ScrollArea>
    <div className="p-2.5 border-t border-line bg-surface/60">
      <Button
        size="sm"
        variant="secondary"
        className="w-full justify-center"
        leftSection={<Plus className="w-3.5 h-3.5" />}
        onClick={onAdd}
      >
        Add column
      </Button>
    </div>
  </div>
);
