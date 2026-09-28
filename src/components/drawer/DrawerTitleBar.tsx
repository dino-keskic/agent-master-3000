import React from 'react';
import { Group, TextInput, Tooltip } from '@mantine/core';
import { Check, ExternalLink, Maximize2, Minimize2, Pencil, X } from 'lucide-react';
import { taskHref } from '../../../shared/ids';

interface DrawerTitleBarProps {
  taskId: string;
  title: string;
  editing: boolean;
  draftTitle: string;
  /** Left out in a split view, where the workspace is always full width. */
  expanded?: boolean;
  onDraftTitleChange: (value: string) => void;
  onStartEditing: () => void;
  onCancelEditing: () => void;
  onSaveTitle: () => void;
  onToggleExpanded?: () => void;
  /** Panel controls the split view adds: open beside, the sidebar toggle. */
  controls?: React.ReactNode;
  onClose: () => void;
  closeLabel: string;
}

/** A panel's header: which task this is, its title, and the panel controls. */
export const DrawerTitleBar: React.FC<DrawerTitleBarProps> = ({
  taskId,
  title,
  editing,
  draftTitle,
  expanded,
  onDraftTitleChange,
  onStartEditing,
  onCancelEditing,
  onSaveTitle,
  onToggleExpanded,
  controls,
  onClose,
  closeLabel
}) => (
  <Group gap="xs" wrap="nowrap" className="w-full min-w-0">
    <span className="inline-flex items-center gap-1.5 shrink-0 rounded-full border border-line px-2.5 py-[3px] font-mono text-[12px] text-ink-2">
      <span className="w-1.5 h-1.5 rounded-full bg-ink-4" />
      {taskId}
    </span>

    {editing ? (
      <Group gap={4} wrap="nowrap" className="flex-1 min-w-0">
        <TextInput
          size="xs"
          value={draftTitle}
          onChange={(e) => onDraftTitleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSaveTitle();
            if (e.key === 'Escape') {
              // Escape here means "stop editing", not "close the panel".
              e.preventDefault();
              onCancelEditing();
            }
          }}
          autoFocus
          className="flex-1"
        />
        <button type="button" className="icon-btn" aria-label="Save title" onClick={onSaveTitle}>
          <Check className="w-3.5 h-3.5" />
        </button>
        <button type="button" className="icon-btn" aria-label="Cancel editing" onClick={onCancelEditing}>
          <X className="w-3.5 h-3.5" />
        </button>
      </Group>
    ) : (
      <h2
        className="m-0 flex-1 min-w-0 text-[14px] font-semibold leading-[1.35] text-ink truncate cursor-pointer"
        onClick={onStartEditing}
      >
        {title}
      </h2>
    )}

    <Group gap={2} wrap="nowrap" className="shrink-0">
      {!editing && (
        <Tooltip label="Edit title" withArrow>
          <button type="button" className="icon-btn" aria-label="Edit title" onClick={onStartEditing}>
            <Pencil className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
      )}
      {controls}
      {onToggleExpanded && (
        <Tooltip label={expanded ? 'Collapse panel' : 'Expand panel'} withArrow>
          <button
            type="button"
            className="icon-btn"
            aria-label={expanded ? 'Collapse panel' : 'Expand panel'}
            onClick={onToggleExpanded}
          >
            {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </Tooltip>
      )}
      <Tooltip label="Open this task in a new tab" withArrow>
        <button
          type="button"
          className="icon-btn"
          aria-label="Open in a new tab"
          onClick={() => window.open(taskHref(taskId), '_blank', 'noopener')}
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
      <Tooltip label={closeLabel} withArrow>
        <button type="button" className="icon-btn" aria-label={closeLabel} onClick={onClose}>
          <X className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
    </Group>
  </Group>
);
