import React from 'react';
import { Group, Menu, Stack, Tooltip } from '@mantine/core';
import { AlertTriangle, ChevronDown, Columns3, ExternalLink, Folder, GitBranch } from 'lucide-react';
import { BoardTask, ProjectFolder } from '../../../shared/types';
import { EditorOption } from '../../api';
import { SectionLabel } from './SectionLabel';
import { Button, Chip, Type } from '../ui';

/**
 * Where the work happens: the folder, the project and worktree it belongs to,
 * and the way out to an editor.
 *
 * The folder can be gone — a deleted worktree, a moved checkout — and saying so
 * here is the only warning the user gets before a run fails on it.
 *
 * The project badge is also the way to change it: a project *is* a folder, so
 * the thing that says where the work lives is the honest place to move it —
 * clicking it opens the dialog that picks the project and the checkout.
 */
export const LocationSection: React.FC<{
  task: BoardTask;
  /** The folder of the session on screen, when it differs from the task's. */
  viewedCwd?: string;
  projects: ProjectFolder[];
  editors: EditorOption[];
  primaryEditor?: EditorOption;
  onOpenFolder: (editorId: string) => void;
  /** Open the dialog that sends the task to another project or checkout. */
  onRequestMove: () => void;
}> = ({ task, viewedCwd, projects, editors, primaryEditor, onOpenFolder, onRequestMove }) => {
  const folderGone = task.cwdExists === false;

  return (
    <Stack gap={8}>
      <SectionLabel>Location</SectionLabel>

      <Group gap={6} wrap="nowrap" align="flex-start">
        <Folder className="w-3.5 h-3.5 text-ink-3 shrink-0 mt-0.5" />
        <Tooltip label={viewedCwd || task.cwd} withArrow multiline maw={360}>
          <Type role="copy" as="span" className="break-all">{viewedCwd || task.cwd}</Type>
        </Tooltip>
      </Group>

      {folderGone && (
        <Group gap={6} wrap="nowrap" className="text-wait-fg">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <Type role="label" tone="wait">This folder no longer exists</Type>
        </Group>
      )}

      {(projects.length > 0 || task.projectName || task.worktreeLabel) && (
        <Group gap={6} wrap="wrap">
          {projects.length > 0 ? (
            <Tooltip label="Move this task to another project or worktree" withArrow>
              <Chip as="button" className="cursor-pointer" onClick={onRequestMove}>
                {task.projectName || 'No project'}
                <ChevronDown className="w-3 h-3" />
              </Chip>
            </Tooltip>
          ) : task.projectName && (
            <Chip>{task.projectName}</Chip>
          )}
          {task.worktreeLabel && (
            <Chip>
              <GitBranch className="w-3 h-3" />
              {task.worktreeLabel}
            </Chip>
          )}
        </Group>
      )}

      {primaryEditor && !folderGone && (
        <Group gap={4} wrap="nowrap">
          <Button
            size="sm"
            variant="secondary"
            className="flex-1"
            onClick={() => onOpenFolder(primaryEditor.id)}
            leftSection={<ExternalLink className="w-3 h-3" />}
          >
            Open in {primaryEditor.label}
          </Button>
          {editors.length > 1 && (
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <Button size="icon" variant="secondary" aria-label="Open in another editor" className="w-7 h-7">
                  <Columns3 className="w-3.5 h-3.5" />
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Open folder in</Menu.Label>
                {editors.map((editor) => (
                  <Menu.Item key={editor.id} onClick={() => onOpenFolder(editor.id)}>
                    {editor.label}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
      )}
    </Stack>
  );
};
