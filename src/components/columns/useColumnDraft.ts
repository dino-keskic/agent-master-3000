import { useState } from 'react';
import { BoardColumn } from '../../../shared/types';
import { appendColumn, canSaveColumnDraft, cleanColumnDraft, moveColumn, removeColumn } from '../../../shared/board/columnDraft';

/**
 * The column list being edited, before it is saved.
 *
 * Nothing here touches the board — the draft is the editor's own copy, and
 * only `cleaned()` speaks in terms the board understands.
 */

export interface ColumnDraft {
  columns: BoardColumn[];
  selectedId: string | undefined;
  select: (id: string) => void;
  /** Always in range while there is a column, so the arrows can compare it. */
  selectedIndex: number;
  selected: BoardColumn | undefined;
  patch: (updates: Partial<BoardColumn>) => void;
  move: (index: number, dir: -1 | 1) => void;
  remove: (index: number) => void;
  add: () => void;
  canSave: boolean;
  cleaned: () => BoardColumn[];
}

export function useColumnDraft(columns: BoardColumn[], opened: boolean): ColumnDraft {
  const [draft, setDraft] = useState<BoardColumn[]>(columns);
  const [selectedId, setSelectedId] = useState(columns[0]?.id);

  // Reseed the draft when the modal opens, during render rather than in an
  // effect so the first painted frame already shows the current columns.
  const [seededFor, setSeededFor] = useState<BoardColumn[] | null>(null);
  if (opened && seededFor !== columns) {
    setSeededFor(columns);
    const next = columns.map((column) => ({ ...column }));
    setDraft(next);
    setSelectedId((current) => (next.some((c) => c.id === current) ? current : next[0]?.id));
  }

  const selectedIndex = Math.max(0, draft.findIndex((column) => column.id === selectedId));

  return {
    columns: draft,
    selectedId,
    select: setSelectedId,
    selectedIndex,
    selected: draft[selectedIndex],
    patch: (updates) => {
      setDraft((prev) => prev.map((column, i) => (i === selectedIndex ? { ...column, ...updates } : column)));
    },
    move: (index, dir) => setDraft((prev) => moveColumn(prev, index, dir)),
    remove: (index) => {
      const next = removeColumn(draft, index);
      setDraft(next.columns);
      setSelectedId(next.selectId);
    },
    add: () => {
      const next = appendColumn(draft);
      setDraft(next.columns);
      setSelectedId(next.id);
    },
    canSave: canSaveColumnDraft(draft),
    cleaned: () => cleanColumnDraft(draft)
  };
}
