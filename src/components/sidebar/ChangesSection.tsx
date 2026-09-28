import React from 'react';
import { Group, Stack, Tooltip } from '@mantine/core';
import { FileDiff } from 'lucide-react';
import { BoardTask } from '../../../shared/types';
import { shortFileLabels } from '../../../shared/format';
import { Type } from '../ui';
import { SectionLabel } from './SectionLabel';

/**
 * What the agent has changed in the folder, committed and not.
 *
 * Nothing at all is not worth a heading, so a task that has not touched its
 * folder yet renders no section rather than an empty one.
 */
export const ChangesSection: React.FC<{ task: BoardTask }> = ({ task }) => {
  const diff = task.changeSummary;
  const hasDiff = !!diff && (diff.files > 0 || diff.additions > 0 || diff.deletions > 0);
  const dirtyFiles = task.cwdDirtyFiles || [];
  const dirtyLabels = shortFileLabels(dirtyFiles);
  if (!hasDiff && dirtyLabels.length === 0) return null;

  return (
    <Stack gap={8}>
      <SectionLabel>Changes</SectionLabel>

      {hasDiff && (
        <Group gap={6} wrap="nowrap">
          <FileDiff className="w-3.5 h-3.5 text-ink-3 shrink-0" />
          <Type role="stat">
            {diff.files} file{diff.files === 1 ? '' : 's'}{' '}
            <span className="text-add">+{diff.additions}</span>{' '}
            <span className="text-del">−{diff.deletions}</span>
          </Type>
        </Group>
      )}

      {dirtyLabels.length > 0 && (
        <Stack gap={2}>
          <Type role="meta">{dirtyFiles.length} uncommitted</Type>
          {dirtyLabels.map((file) => (
            <Tooltip key={file.path} label={file.path} withArrow position="left">
              <Type role="stat" className="block truncate">{file.label}</Type>
            </Tooltip>
          ))}
        </Stack>
      )}
    </Stack>
  );
};
