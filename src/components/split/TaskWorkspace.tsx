import React, { useState } from 'react';
import { Drawer } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { X } from 'lucide-react';
import { OpenTasks } from '../../app/useOpenTasks';
import { TaskActions } from '../../app/useTaskActions';
import { OpenCodeAgent, OpenCodeModel } from '../../../shared/sessions/types';
import { BoardColumn, BoardTask, ProjectFolder } from '../../../shared/types';
import { SessionStateDot } from '../session/SessionStateDot';
import { TaskPanel } from '../drawer/TaskPanel';

/**
 * Where open tasks are read and worked on: one panel, or up to three side by
 * side.
 *
 * One task looks exactly like the drawer always did. A second one makes the
 * workspace full width with equal columns. On a narrow screen there is no room
 * for columns, so the panels become tabs and only the focused one is shown.
 * What a panel holds is `TaskPanel`; which tasks are open is `useOpenTasks`.
 */

interface TaskWorkspaceProps {
  open: OpenTasks;
  boardTasks: BoardTask[];
  columns: BoardColumn[];
  models: OpenCodeModel[];
  agents: OpenCodeAgent[];
  projects: ProjectFolder[];
  actions: TaskActions;
  onApplyTask: (task: BoardTask) => void;
}

const EXPANDED_KEY = 'agentMasterDrawerExpanded';

const WORKSPACE_STYLES = {
  content: { backgroundColor: 'rgb(var(--c-canvas))', color: 'rgb(var(--c-ink))' },
  body: { padding: 0, height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }
} as const;

/**
 * Reviewing a long transcript or a wide diff wants more than the default panel,
 * and the preference should outlive the workspace being closed.
 */
function useExpandedPreference(): [boolean, () => void] {
  const [expanded, setExpanded] = useState(() => {
    try {
      return window.localStorage.getItem(EXPANDED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggle = () => {
    setExpanded((prev) => {
      try {
        window.localStorage.setItem(EXPANDED_KEY, prev ? '0' : '1');
      } catch {
        // A private window: the preference just lasts for this page.
      }
      return !prev;
    });
  };
  return [expanded, toggle];
}

export const TaskWorkspace: React.FC<TaskWorkspaceProps> = ({
  open,
  boardTasks,
  columns,
  models,
  agents,
  projects,
  actions,
  onApplyTask
}) => {
  const [expanded, toggleExpanded] = useExpandedPreference();
  const narrow = useMediaQuery('(max-width: 899px)') ?? false;
  const panes = open.tasks;
  const split = panes.length > 1;
  const focused = panes.find((task) => task.id === open.focusedId) ?? panes[panes.length - 1];
  // Narrow shows only the focused panel, but the others stay mounted so a
  // half-typed prompt or a scroll position survives switching tabs.
  const tabbed = narrow && split;

  return (
    <Drawer
      opened={panes.length > 0}
      onClose={open.closeAll}
      position="right"
      size={split || expanded ? '100%' : 'min(1180px, 94vw)'}
      withCloseButton={false}
      // Escape closes the panel it was pressed in, not the whole workspace.
      closeOnEscape={false}
      styles={WORKSPACE_STYLES}
    >
      {tabbed && (
        <PaneTabs panes={panes} focusedId={focused?.id} onFocus={open.focus} onClose={open.close} />
      )}

      <div className="flex-1 flex min-h-0 min-w-0">
        {panes.map((task, index) => (
          <div
            key={task.id}
            // A class, not the `hidden` attribute: `flex` would win over it.
            className={`flex-1 min-w-0 min-h-0 ${tabbed && task !== focused ? 'hidden' : 'flex'} ${
              index > 0 && !tabbed ? 'border-l border-line' : ''
            }`}
          >
            <TaskPanel
              task={task}
              focusSessionId={open.focusSessionIds[task.id] ?? null}
              onFocusHandled={open.focusHandled}
              boardTasks={boardTasks}
              openTaskIds={open.openTaskIds}
              split={split}
              focused={task === focused}
              expanded={expanded}
              onToggleExpanded={toggleExpanded}
              onFocus={open.focus}
              onOpenBeside={open.openBeside}
              onClose={open.close}
              columns={columns}
              models={models}
              agents={agents}
              projects={projects}
              onUpdateTask={actions.updateTask}
              onRunTask={actions.runTask}
              onSendPrompt={actions.sendPrompt}
              onStopTask={actions.stopTask}
              onStopSession={actions.stopSession}
              onRespond={actions.respond}
              onMoveTask={actions.moveTask}
              onApplyTask={onApplyTask}
            />
          </div>
        ))}
      </div>
    </Drawer>
  );
};

/** The narrow-screen stand-in for columns: one tab per open task. */
const PaneTabs: React.FC<{
  panes: BoardTask[];
  focusedId?: string;
  onFocus: (taskId: string) => void;
  onClose: (taskId: string) => void;
}> = ({ panes, focusedId, onFocus, onClose }) => (
  <div role="tablist" className="flex shrink-0 overflow-x-auto border-b border-line bg-surface-3">
    {panes.map((task) => {
      const active = task.id === focusedId;
      return (
        <div
          key={task.id}
          className={`flex items-center gap-1.5 min-w-0 max-w-[60%] pl-3 pr-1 border-b-2 ${
            active ? 'border-accent text-ink' : 'border-transparent text-ink-3'
          }`}
        >
          <button
            type="button"
            role="tab"
            aria-selected={active}
            className="flex items-center gap-1.5 min-w-0 py-2 bg-transparent border-0 text-inherit cursor-pointer"
            onClick={() => onFocus(task.id)}
          >
            <SessionStateDot state={task.runState} />
            <span className="font-mono text-[11px] truncate">{task.id}</span>
          </button>
          <button
            type="button"
            aria-label={`Close ${task.id}`}
            className="p-1 bg-transparent border-0 text-ink-3 cursor-pointer"
            onClick={() => onClose(task.id)}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      );
    })}
  </div>
);
