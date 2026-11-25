import React from 'react';
import { Group, Menu, Stack, Tooltip } from '@mantine/core';
import { AlertTriangle, ChevronDown, ExternalLink, Folder, GitBranch } from 'lucide-react';
import { BoardTask, ProjectFolder } from '../../../shared/types';
import { shortPath } from '../../../shared/format';
import { EditorOption } from '../../api';
import { SectionLabel } from './SectionLabel';
import { Button, Chip, Type } from '../ui';

/**
 * Compact location section: project/worktree chips (click to move), shortened
 * folder path with full path in tooltip, and a quiet editor launcher.
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
  const fullPath = viewedCwd || task.cwd;

  return (
    <Stack gap={6} className="px-1">
      <Group justify="space-between" align="center" wrap="nowrap">
        <SectionLabel>Location</SectionLabel>
        {primaryEditor && !folderGone && (
          <Group gap={2} wrap="nowrap">
            <Button
              size="xs"
              variant="ghost"
              onClick={() => onOpenFolder(primaryEditor.id)}
              leftSection={<ExternalLink className="w-3 h-3" />}
            >
              {primaryEditor.label}
            </Button>
            {editors.length > 1 && (
              <Menu position="bottom-end" withinPortal>
                <Menu.Target>
                  <button
                    type="button"
                    aria-label="Open in another editor"
                    className="icon-btn w-5 h-5"
                  >
                    <ChevronDown className="w-3 h-3" />
                  </button>
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
      </Group>

      {(projects.length > 0 || task.projectName || task.worktreeLabel) && (
        <Group gap={5} wrap="wrap">
          {projects.length > 0 ? (
            <Tooltip label="Move this task to another project or worktree" withArrow>
              <Chip as="button" className="cursor-pointer" onClick={onRequestMove}>
                {task.projectName || 'No project'}
                <ChevronDown className="w-3 h-3" />
              </Chip>
            </Tooltip>
          ) : (
            task.projectName && <Chip>{task.projectName}</Chip>
          )}
          {task.worktreeLabel && (
            <Chip>
              <GitBranch className="w-3 h-3" />
              {task.worktreeLabel}
            </Chip>
          )}
        </Group>
      )}

      <Tooltip label={fullPath} withArrow multiline maw={360} position="left">
        <Group gap={6} wrap="nowrap" className="min-w-0">
          <Folder className="w-3 h-3 text-ink-4 shrink-0" />
          <span className="font-mono text-[11px] text-ink-3 truncate">{shortPath(fullPath)}</span>
        </Group>
      </Tooltip>

      {folderGone && (
        <Group gap={6} wrap="nowrap" className="text-wait-fg">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <Type role="label" tone="wait">This folder no longer exists</Type>
        </Group>
      )}
    </Stack>
  );
};
