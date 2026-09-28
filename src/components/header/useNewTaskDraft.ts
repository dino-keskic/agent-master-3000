import { useState } from 'react';
import { BoardTask, GlobalSettings, ProjectFolder, PromptImage } from '../../../shared/types';
import { imageCountLabel } from '../../../shared/composer/promptImages';
import { deriveTaskTitle } from '../../../shared/format';
import { notifySuccess, reportError } from '../../app/notify';
import { WorktreeTarget, useWorktreeTarget } from './useWorktreeTarget';

/**
 * The task being typed in the header, up to the moment it lands on the board.
 *
 * It carries the board's defaults — model, agent, thinking level, permission
 * mode — because a task created here has no column of its own to read them
 * from yet.
 */

export interface NewTaskDraft {
  prompt: string;
  setPrompt: (text: string) => void;
  isSubmitting: boolean;
  /** Where it will run, and the picker's state for it. */
  worktree: WorktreeTarget;
  project?: ProjectFolder;
  /** True when the first column starts the agent on arrival. */
  runsOnCreate: boolean;
  firstColumnTitle?: string;
  /**
   * Create the task. `composed` is the prompt the composer built — what was
   * typed plus any ticket blocks it fetched. The card's title and description
   * stay with the typed text; only the turn itself carries the attached context.
   * `images` ride along with the task's first turn.
   */
  submit: (composed: string, images?: PromptImage[]) => Promise<void>;
}

export function useNewTaskDraft(
  settings: GlobalSettings,
  projects: ProjectFolder[],
  onCreateTask: (taskInput: Partial<BoardTask>, startImmediately?: boolean) => Promise<void>
): NewTaskDraft {
  const [prompt, setPrompt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const project = projects.find(p => p.id === settings.selectedProjectId) || projects[0];
  const worktree = useWorktreeTarget(project?.path, settings.defaultCwd);

  // A new task lands in the first column, so that column's autoRun — not a
  // separate composer toggle — decides whether the agent starts right away.
  const firstColumn = settings.columns[0];
  const runsOnCreate = firstColumn?.autoRun === true;

  return {
    prompt,
    setPrompt,
    isSubmitting,
    worktree,
    project,
    runsOnCreate,
    firstColumnTitle: firstColumn?.title,

    async submit(composed, images) {
      if ((!prompt.trim() && !images?.length) || isSubmitting) return;

      setIsSubmitting(true);
      try {
        const text = prompt.trim();
        const turn = composed.trim() || text;
        // A card dropped as a picture with nothing typed still needs a name.
        const derivedTitle = deriveTaskTitle(text) || imageCountLabel(images || []);
        const { cwd, worktreeName } = await worktree.resolveCwd(text);

        await onCreateTask(
          {
            title: derivedTitle,
            prompt: turn,
            description: text,
            // Keeps `{{prompt}}` exact even after columns stack their templates.
            originalPrompt: turn,
            model: settings.defaultModel,
            agent: settings.defaultAgent,
            thinkingLevel: settings.defaultThinkingLevel,
            permissionMode: settings.defaultPermissionMode,
            cwd,
            projectId: project?.id,
            columnId: firstColumn?.id,
            promptImages: images?.length ? images : undefined
          },
          runsOnCreate
        );

        notifySuccess(
          runsOnCreate ? 'Agent dispatched' : 'Queued',
          worktreeName ? `"${derivedTitle}" in worktree ${worktreeName}` : `"${derivedTitle}"`
        );

        setPrompt('');
      } catch (err) {
        reportError('Could not create task', err);
      } finally {
        setIsSubmitting(false);
      }
    }
  };
}
