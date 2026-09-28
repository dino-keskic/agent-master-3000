import React from 'react';
import { Group, Stack } from '@mantine/core';
import { LayoutGrid } from 'lucide-react';
import { OpenCodeAgent, OpenCodeModel } from '../../../shared/sessions/types';
import { BoardTask, GlobalSettings, ProjectFolder } from '../../../shared/types';
import { worktreeName } from '../../../shared/git/worktree';
import { ticketInText } from '../../../shared/task/links';
import { BoardLoadPhase, connectionLabel } from '../../../shared/board/load';
import { Severity } from '../../../shared/setup/report';
import { Composer } from '../composer/Composer';
import { BoardActions } from './BoardActions';
import { TaskTargetBar } from './TaskTargetBar';
import { useNewTaskDraft } from './useNewTaskDraft';

interface HeaderProps {
  settings: GlobalSettings;
  projects: ProjectFolder[];
  models: OpenCodeModel[];
  agents: OpenCodeAgent[];
  /** Where the board is between a first connect and a live feed. */
  connection: BoardLoadPhase;
  onUpdateSettings: (settingsPartial: Partial<GlobalSettings>) => void | Promise<void>;
  onPickProjectFolder: () => unknown;
  onOpenSessionImport: () => void;
  onOpenColumnEditor: () => void;
  onOpenNotifications: () => void;
  onOpenSpend: () => void;
  onOpenComments: () => void;
  /** Opens the archive of tasks that were taken off the board. */
  onOpenArchive: () => void;
  onOpenSettings: () => void;
  /** How the board's locations look; an error lights the settings button. */
  setupSeverity: Severity;
  /** Open review notes across tasks. */
  openCommentsCount?: number;
  /** This week's board-wide spend, once it has been read. */
  weekSpend?: number;
  /** True after the first spend read, including a $0 week. */
  spendReady?: boolean;
  /** Unread inbox items. */
  unreadNotificationCount: number;
  /** Sessions blocked on a permission or a question. */
  awaitingSessionCount: number;
  /** In-flight tool calls (shell, etc.). */
  backgroundTaskCount: number;
  /** Set when desktop alerts are switched on but cannot reach this browser. */
  desktopAlertWarning?: string;
  onDeleteProject?: (projectId: string) => void;
  onCreateTask: (taskInput: Partial<BoardTask>, startImmediately?: boolean) => Promise<void>;
  promptInputRef?: React.MutableRefObject<HTMLTextAreaElement | null>;
}

/**
 * The board's one persistent surface: what it is connected to, what it opens,
 * and the box a new task is written in. Everything a task needs to start lives
 * in `useNewTaskDraft` — this is where it is arranged.
 */
export const Header: React.FC<HeaderProps> = ({
  settings,
  projects,
  models,
  agents,
  connection,
  onUpdateSettings,
  onPickProjectFolder,
  onOpenSessionImport,
  onOpenColumnEditor,
  onOpenNotifications,
  onOpenSpend,
  onOpenComments,
  onOpenArchive,
  onOpenSettings,
  setupSeverity,
  openCommentsCount,
  weekSpend,
  spendReady,
  unreadNotificationCount,
  awaitingSessionCount,
  backgroundTaskCount,
  desktopAlertWarning,
  onCreateTask,
  promptInputRef
}) => {
  const draft = useNewTaskDraft(settings, projects, onCreateTask);
  const projectPath = draft.project?.path;

  return (
    <header className="sticky top-0 z-40 bg-surface border-b border-hairline shadow-panel px-[18px] py-3 backdrop-blur-panel overflow-visible">
      <Stack className="max-w-[2200px] mx-auto" gap="sm">
        <Group justify="space-between" align="center">
          <Group gap="sm">
            <div className="bg-acc-tile rounded-lg p-[7px]">
              <LayoutGrid className="w-4 h-4 text-white" />
            </div>
            <Group gap={8} align="baseline">
              <h1 className="text-[17px] font-bold tracking-[-0.02em] text-ink m-0">
                Agent Master 3000
              </h1>
              <span className="font-mono text-[11px] leading-none px-[9px] py-[2px] rounded-full bg-acc-bg text-acc-fg">
                OpenCode ACP
              </span>
            </Group>
            <Group gap={6} className="pl-3 border-l border-line">
              <span className={`w-1.5 h-1.5 rounded-full ${connection === 'ready' ? 'bg-ok' : 'bg-err'}`} />
              <span className="text-[11px] text-ink-3">{connectionLabel(connection)}</span>
            </Group>
          </Group>

          <BoardActions
            weekSpend={weekSpend}
            spendReady={spendReady}
            unreadNotificationCount={unreadNotificationCount}
            awaitingSessionCount={awaitingSessionCount}
            backgroundTaskCount={backgroundTaskCount}
            desktopAlertWarning={desktopAlertWarning}
            openCommentsCount={openCommentsCount}
            onOpenSpend={onOpenSpend}
            onOpenNotifications={onOpenNotifications}
            onOpenComments={onOpenComments}
            onOpenColumnEditor={onOpenColumnEditor}
            onOpenSessionImport={onOpenSessionImport}
            onOpenArchive={onOpenArchive}
            onOpenSettings={onOpenSettings}
            setupSeverity={setupSeverity}
          />
        </Group>

        <Stack gap={8}>
          <TaskTargetBar
            projects={projects}
            selectedProjectId={settings.selectedProjectId || draft.project?.id}
            projectPath={projectPath}
            worktree={draft.worktree}
            slugPreview={draft.prompt.trim() ? worktreeName(ticketInText(draft.prompt), draft.prompt) : undefined}
            onSelectProject={(project) => void onUpdateSettings({
              selectedProjectId: project.id,
              defaultCwd: project.path
            })}
            onPickProjectFolder={() => void onPickProjectFolder()}
          />

          <Composer
            value={draft.prompt}
            onChange={draft.setPrompt}
            onSubmit={draft.submit}
            mentionPlacement="below"
            cwd={draft.worktree.target || projectPath || settings.defaultCwd}
            placeholder="Describe a task…"
            textareaRef={promptInputRef}
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
        </Stack>
      </Stack>
    </header>
  );
};
