import React, { useEffect, useRef } from 'react';
import { Modal } from '@mantine/core';
import { OpenCodeAgent, OpenCodeModel } from '../../../shared/sessions/types';
import { GlobalSettings, ProjectFolder } from '../../../shared/types';
import { worktreeName } from '../../../shared/git/worktree';
import { pullRequestIn, ticketInText } from '../../../shared/task/links';
import { Composer } from '../composer/Composer';
import { TaskTargetBar } from './TaskTargetBar';
import { NewTaskDraft } from './useNewTaskDraft';

/**
 * The sheet a new task is written in: where it runs, what it says, how it runs.
 *
 * A line typed into the top bar's field is enough for most tasks. This is for
 * the ones that want a worktree, a ticket or a screenshot — the full composer,
 * raised when asked for instead of standing on every screen. What is typed
 * stays in the draft (`useNewTaskDraft`, held by `App`), so closing the sheet
 * loses nothing.
 */

interface NewTaskSheetProps {
  opened: boolean;
  onClose: () => void;
  settings: GlobalSettings;
  projects: ProjectFolder[];
  models: OpenCodeModel[];
  agents: OpenCodeAgent[];
  draft: NewTaskDraft;
  onUpdateSettings: (settingsPartial: Partial<GlobalSettings>) => void | Promise<void>;
  onPickProjectFolder: () => unknown;
  onDeleteProject?: (projectId: string) => void;
}

export const NewTaskSheet: React.FC<NewTaskSheetProps> = ({
  opened,
  onClose,
  settings,
  projects,
  models,
  agents,
  draft,
  onUpdateSettings,
  onPickProjectFolder,
  onDeleteProject
}) => {
  const projectPath = draft.project?.path;
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // The sheet is opened to type in. Mantine's focus trap lands on the project
  // picker, the first focusable thing, so the caret is moved once it is up.
  useEffect(() => {
    if (!opened) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [opened]);

  const where = draft.runsOnCreate ? 'Starts an agent right away' : `Lands in ${draft.firstColumnTitle || 'Backlog'}`;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size={760}
      yOffset="12vh"
      title={
        <span className="flex items-baseline gap-2">
          <span className="text-[15px] font-semibold text-ink">New task</span>
          <span className="text-[12px] text-ink-3">{where}</span>
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        <TaskTargetBar
          projects={projects}
          selectedProjectId={settings.selectedProjectId || draft.project?.id}
          projectPath={projectPath}
          worktree={draft.worktree}
          slugPreview={draft.prompt.trim() ? worktreeName(ticketInText(draft.prompt), draft.prompt) : undefined}
          pullRequest={pullRequestIn(undefined, draft.prompt)}
          onSelectProject={(project) => void onUpdateSettings({ selectedProjectId: project.id, defaultCwd: project.path })}
          onPickProjectFolder={() => void onPickProjectFolder()}
          onDeleteProject={onDeleteProject}
        />
        <Composer
          value={draft.prompt}
          onChange={draft.setPrompt}
          onSubmit={async (composed, images) => {
            if (await draft.submit(composed, images)) onClose();
          }}
          mentionPlacement="below"
          cwd={draft.worktree.target || projectPath || settings.defaultCwd}
          placeholder="Describe a task…"
          textareaRef={inputRef}
          models={models}
          agents={agents}
          thinkingLevel={settings.defaultThinkingLevel}
          onThinkingLevelChange={(val) => void onUpdateSettings({ defaultThinkingLevel: val })}
          model={settings.defaultModel}
          onModelChange={(val) => void onUpdateSettings({ defaultModel: val })}
          permissionMode={settings.defaultPermissionMode}
          onPermissionModeChange={(val) => void onUpdateSettings({ defaultPermissionMode: val })}
          agent={settings.defaultAgent}
          onAgentChange={(val) => void onUpdateSettings({ defaultAgent: val })}
          submitting={draft.isSubmitting}
          submitKind={draft.runsOnCreate ? 'dispatch' : 'queue'}
          submitTooltip={draft.runsOnCreate ? 'Dispatch (⌘Enter)' : `Queue to ${draft.firstColumnTitle || 'Backlog'} (⌘Enter)`}
        />
      </div>
    </Modal>
  );
};
