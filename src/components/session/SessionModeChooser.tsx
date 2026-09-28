import { Button, Group, Paper, Text } from '@mantine/core';
import { GitFork, Plus } from 'lucide-react';
import { MODE_COPY, SessionStartMode } from './sessionMode';

/**
 * Which kind of session is being started, and what that choice means.
 *
 * A fork copies a session's messages, so the copy starts knowing what the
 * original knew; blank starts empty. The panel under the buttons names what
 * would be copied, because the two look identical once they are open.
 */
export function SessionModeChooser({
  mode,
  canFork,
  taskTitle,
  sourceTitle,
  onModeChange
}: {
  mode: SessionStartMode;
  /** False when the task has never run — there is nothing to fork yet. */
  canFork: boolean;
  taskTitle: string;
  sourceTitle?: string;
  onModeChange: (mode: SessionStartMode) => void;
}) {
  return (
    <>
      <Group gap={6} wrap="nowrap">
        <Button
          size="compact-xs"
          variant={mode === 'fork' ? 'filled' : 'default'}
          color="accent"
          disabled={!canFork}
          leftSection={<GitFork className="w-3 h-3" />}
          onClick={() => onModeChange('fork')}
        >
          Fork
        </Button>
        <Button
          size="compact-xs"
          variant={mode === 'new' ? 'filled' : 'default'}
          color="accent"
          leftSection={<Plus className="w-3 h-3" />}
          onClick={() => onModeChange('new')}
        >
          Blank
        </Button>
      </Group>

      <Paper p="xs" radius="md" className="bg-surface border border-line/70">
        <Text size="xs" c="dimmed">
          {MODE_COPY[mode].help}
        </Text>
        {mode === 'fork' && sourceTitle && (
          <Text size="xs" className="text-slate-300 pt-1">
            Copying <span className="font-semibold text-acc-fg">{sourceTitle}</span> on{' '}
            <span className="font-semibold text-slate-200">{taskTitle}</span>
          </Text>
        )}
      </Paper>
    </>
  );
}
