import React from 'react';
import { OpenCodeAgent, OpenCodeModel } from '../../../shared/sessions/types';
import { BoardTask, ProjectFolder } from '../../../shared/types';
import { sessionRunSettings } from '../../../shared/task/sessions';
import { DEFAULT_PERMISSION_MODE } from '../../../shared/agent/permissions';
import { ViewedSession } from '../../../shared/task/viewedSession';
import { NewSessionModal } from '../session/NewSessionModal';
import { SessionStartMode } from '../session/sessionMode';
import { DrawerActions } from './drawerActions';

/**
 * Starting another session on this task, forked from a specific session (or the
 * one on screen) or fresh.
 */

interface DrawerSessionModalProps {
  task: BoardTask;
  view: ViewedSession;
  mode: SessionStartMode | null;
  sourceSessionId?: string;
  onModeChange: (mode: SessionStartMode | null) => void;
  actions: DrawerActions;
  models: OpenCodeModel[];
  agents: OpenCodeAgent[];
  projects: ProjectFolder[];
  onUpdateTask: (taskId: string, updates: Partial<BoardTask>) => void | Promise<void>;
}

export const DrawerSessionModal: React.FC<DrawerSessionModalProps> = ({
  task,
  view,
  mode,
  sourceSessionId,
  onModeChange,
  actions,
  models,
  agents,
  projects,
  onUpdateTask
}) => {
  const source = (sourceSessionId
    ? view.sessions.find((s) => s.sessionId === sourceSessionId)
    : undefined) ?? view.viewed;
  const runsAs = sessionRunSettings(task, source?.chosen);

  return (
    <NewSessionModal
      opened={mode !== null}
      mode={mode || 'fork'}
      onModeChange={onModeChange}
      onClose={() => onModeChange(null)}
      onSubmit={(data) =>
        actions.startSession(
          sourceSessionId && data.mode === 'fork'
            ? { ...data, sourceSessionId }
            : data
        )
      }
      defaultModel={runsAs.model || task.model}
      defaultAgent={runsAs.agent || task.agent}
      defaultThinkingLevel={runsAs.thinkingLevel || task.thinkingLevel}
      permissionMode={task.permissionMode || DEFAULT_PERMISSION_MODE}
      onPermissionModeChange={(val) => void onUpdateTask(task.id, { permissionMode: val })}
      models={models}
      agents={agents}
      taskTitle={task.title}
      sourceTitle={source?.title}
      canFork={view.sessions.length > 0}
      projects={projects}
      defaultProjectId={task.projectId}
      defaultCwd={task.cwd}
    />
  );
};
