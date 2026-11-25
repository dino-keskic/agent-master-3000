import React from 'react';
import { Modal } from '@mantine/core';
import { GitFork, Plus } from 'lucide-react';
import { OpenCodeAgent, OpenCodeModel } from '../../../shared/sessions/types';
import { PermissionMode, ProjectFolder } from '../../../shared/types';
import { StartSessionInput } from '../../api';
import { Composer } from '../composer/Composer';
import { Button } from '../ui';
import { MODE_COPY, SessionStartMode } from './sessionMode';
import { useNewSessionForm } from './useNewSessionForm';
import { SessionModeChooser } from './SessionModeChooser';
import { SessionProjectFields } from './SessionProjectFields';

/** Starting a second conversation on a task — forked from one, or empty. */

const MODAL_STYLES = {
  content: { backgroundColor: 'var(--glass-pane)', color: 'rgb(var(--c-ink))' },
  header: { backgroundColor: 'rgb(var(--c-surface))', borderBottom: '1px solid rgb(var(--c-line))' },
  body: { backgroundColor: 'transparent', padding: '16px' }
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
        <div className="flex items-center gap-2">
          {mode === 'fork' ? (
            <GitFork className="w-4 h-4 text-accent" />
          ) : (
            <Plus className="w-4 h-4 text-run-fg" />
          )}
          <span className="text-[14px] font-semibold text-ink">{copy.title}</span>
        </div>
      }
      size="lg"
      styles={MODAL_STYLES}
    >
      <div className="flex flex-col gap-3">
        <SessionModeChooser
          mode={mode}
          canFork={canFork}
          taskTitle={taskTitle}
          sourceTitle={sourceTitle}
          onModeChange={onModeChange}
        />

        {mode === 'new' && projects.length > 0 && <SessionProjectFields form={form} projects={projects} />}

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

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {!form.promptRequired && (
            <Button
              size="sm"
              variant="secondary"
              loading={form.isSubmitting}
              disabled={!!form.prompt.trim()}
              onClick={() => void form.submit()}
            >
              Start empty
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};
