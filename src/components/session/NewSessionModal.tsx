import React from 'react';
import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { GitFork, Plus } from 'lucide-react';
import { OpenCodeAgent, OpenCodeModel } from '../../../shared/sessions/types';
import { PermissionMode, ProjectFolder } from '../../../shared/types';
import { StartSessionInput } from '../../api';
import { Composer } from '../composer/Composer';
import { MODE_COPY, SessionStartMode } from './sessionMode';
import { useNewSessionForm } from './useNewSessionForm';
import { SessionModeChooser } from './SessionModeChooser';
import { SessionProjectFields } from './SessionProjectFields';

/** Starting a second conversation on a task — forked from one, or empty. */

const MODAL_STYLES = {
  content: { backgroundColor: 'rgb(var(--c-canvas))', color: 'rgb(var(--c-ink))' },
  header: { backgroundColor: 'rgb(var(--c-surface-3))', borderBottom: '1px solid rgb(var(--c-line) / 0.7)' },
  body: { backgroundColor: 'rgb(var(--c-canvas))', padding: '16px' }
} as const;

interface NewSessionModalProps {
  opened: boolean;
  mode: SessionStartMode;
  onModeChange: (mode: SessionStartMode) => void;
  onClose: () => void;
  onSubmit: (data: StartSessionInput) => Promise<void>;
  defaultModel: string;
  defaultAgent: string;
  defaultThinkingLevel: string;
  permissionMode: PermissionMode;
  onPermissionModeChange: (value: PermissionMode) => void;
  models: OpenCodeModel[];
  agents: OpenCodeAgent[];
  taskTitle: string;
  /** Title of the session a fork would copy, so the user knows what they get. */
  sourceTitle?: string;
  /** False when the task has never run — there is nothing to fork yet. */
  canFork: boolean;
  projects: ProjectFolder[];
  defaultProjectId?: string;
  defaultCwd?: string;
}

export const NewSessionModal: React.FC<NewSessionModalProps> = ({
  opened,
  mode,
  onModeChange,
  onClose,
  onSubmit,
  defaultModel,
  defaultAgent,
  defaultThinkingLevel,
  permissionMode,
  onPermissionModeChange,
  models,
  agents,
  taskTitle,
  sourceTitle,
  canFork,
  projects,
  defaultProjectId,
  defaultCwd
}) => {
  const form = useNewSessionForm({
    opened,
    mode,
    model: defaultModel,
    agent: defaultAgent,
    thinkingLevel: defaultThinkingLevel,
    projects,
    projectId: defaultProjectId,
    cwd: defaultCwd,
    onSubmit,
    onDone: onClose
  });

  const copy = MODE_COPY[mode];

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          {mode === 'fork' ? (
            <GitFork className="w-4 h-4 text-accent" />
          ) : (
            <Plus className="w-4 h-4 text-teal-400" />
          )}
          <Text fw={600} size="sm">
            {copy.title}
          </Text>
        </Group>
      }
      size="lg"
      styles={MODAL_STYLES}
    >
      <Stack gap="sm">
        <SessionModeChooser
          mode={mode}
          canFork={canFork}
          taskTitle={taskTitle}
          sourceTitle={sourceTitle}
          onModeChange={onModeChange}
        />

        {mode === 'new' && projects.length > 0 && <SessionProjectFields form={form} projects={projects} />}

        {/* The same box as the one in the session below, so a fork is written
            with the `@` files, `/` commands, images and dictation the prompt it
            follows up on was — and picks its model in the same row. */}
        <Composer
          value={form.prompt}
          onChange={form.setPrompt}
          onSubmit={(prompt, images) => form.submit(prompt, images)}
          cwd={form.cwd || defaultCwd}
          placeholder={
            mode === 'fork'
              ? 'e.g. BTW, how does our JWT refresh handle expired sessions?'
              : 'Optional: what should this session start with?'
          }
          models={models}
          agents={agents}
          model={form.model}
          onModelChange={form.setModel}
          agent={form.agent}
          onAgentChange={form.setAgent}
          thinkingLevel={form.thinkingLevel}
          onThinkingLevelChange={form.setThinkingLevel}
          permissionMode={permissionMode}
          onPermissionModeChange={onPermissionModeChange}
          submitting={form.isSubmitting}
          mentionPlacement="below"
          submitTooltip={`${copy.action} (⌘Enter)`}
        />

        <Group justify="flex-end" gap="xs">
          <Button size="xs" variant="subtle" color="gray" onClick={onClose}>
            Cancel
          </Button>
          {/* A blank session is allowed to start with nothing to say; a fork is
              the question you are asking the copy, so it needs the box. */}
          {!form.promptRequired && (
            <Button
              size="xs"
              variant="default"
              loading={form.isSubmitting}
              disabled={!!form.prompt.trim()}
              onClick={() => void form.submit()}
            >
              Start empty
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
};
