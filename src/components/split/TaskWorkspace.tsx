import React, { useMemo, useRef, useState } from 'react';
import { Drawer } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { X } from 'lucide-react';
import { OpenTasks } from '../../app/useOpenTasks';
import { TaskActions } from '../../app/useTaskActions';
import { OpenCodeAgent, OpenCodeModel } from '../../../shared/sessions/types';
import { BoardColumn, BoardTask, ProjectFolder } from '../../../shared/types';
import { withoutManager } from '../../../shared/manager/identity';
import { TaskChangeSummary, changedFileCount } from '../../../shared/git/changeSummary';
import {
  WORK_RAIL_BOUNDS,
  resizeSplitWeights,
  resizedWidth,
  syncSplitWeights
} from '../../../shared/board/panelResize';
import { NARROW_WORKSPACE_PX } from '../../../shared/board/viewport';
import { ResizeHandle } from '../ui/ResizeHandle';
import { usePanelWidth } from '../ui/usePanelWidth';
import { SessionStateDot } from '../session/SessionStateDot';
import { TaskPanel } from '../drawer/TaskPanel';
import { WorkRail } from './WorkRail';

/**
 * Where open tasks are read and worked on: the board folded into a resizable
 * list on the left, and one panel — or up to three resizable panels side by
 * side — filling the rest.
 */

interface TaskWorkspaceProps {
  open: OpenTasks;
  boardTasks: BoardTask[];
  columns: BoardColumn[];
  models: OpenCodeModel[];
  agents: OpenCodeAgent[];
  projects: ProjectFolder[];
  actions: TaskActions;
  /** The board's live change summaries, keyed by task id. */
  changes: Record<string, TaskChangeSummary>;
  onApplyTask: (task: BoardTask) => void;
}

const WORKSPACE_STYLES = {
  content: { backgroundColor: 'var(--session-bg)', color: 'rgb(var(--c-ink))' },
  body: { padding: 0, height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }
} as const;

export const TaskWorkspace: React.FC<TaskWorkspaceProps> = ({
  open,
  boardTasks,
  columns,
  models,
  agents,
  projects,
  actions,
  changes,
  onApplyTask
}) => {
  // The manager is opened from its own button, never from the list.
  const listed = useMemo(() => withoutManager(boardTasks), [boardTasks]);
  const narrow = useMediaQuery(`(max-width: ${NARROW_WORKSPACE_PX}px)`) ?? false;
  const panes = open.tasks;
  const split = panes.length > 1;
  const focused = panes.find((task) => task.id === open.focusedId) ?? panes[panes.length - 1];
  // Narrow shows only the focused panel, but the others stay mounted so a
  // half-typed prompt or a scroll position survives switching tabs.
  const tabbed = narrow && split;

  const workspaceRef = useRef<HTMLDivElement>(null);
  const panesRef = useRef<HTMLDivElement>(null);

  const rail = usePanelWidth('agentMasterWorkRailWidth', WORK_RAIL_BOUNDS);
  const railDragStart = useRef(rail.width);

  const [splitWeights, setSplitWeights] = useState<number[]>(() => syncSplitWeights([], panes.length));
  const syncedWeights = syncSplitWeights(splitWeights, panes.length);
  if (syncedWeights !== splitWeights) setSplitWeights(syncedWeights);
  const splitDragStart = useRef<number[]>(syncedWeights);

  return (
    <Drawer
      opened={panes.length > 0}
      onClose={open.closeAll}
      position="right"
      size="100%"
      withCloseButton={false}
      // Escape closes the panel it was pressed in, not the whole workspace.
      closeOnEscape={false}
      // The whole window changes from board to task: a slide across all of it
      // reads as a page being dragged in, so it cross-fades instead.
      transitionProps={{ transition: 'fade', duration: 120 }}
      styles={WORKSPACE_STYLES}
    >
      {tabbed && (
        <PaneTabs panes={panes} focusedId={focused?.id} onFocus={open.focus} onClose={open.close} />
      )}

      <div ref={workspaceRef} className="flex-1 flex min-h-0 min-w-0">
        {!narrow && (
          <>
            <WorkRail
              tasks={listed}
              columns={columns}
              openTaskIds={open.openTaskIds}
              focusedId={focused?.id}
              width={rail.width}
              onSelect={open.select}
              onBack={open.closeAll}
            />
            <ResizeHandle
              label="Resize task list panel"
              onDragStart={() => {
                railDragStart.current = rail.width;
              }}
              onDragMove={(deltaX) => {
                const containerWidth = workspaceRef.current?.clientWidth;
                rail.setWidth(
                  resizedWidth(railDragStart.current, deltaX, 'right', WORK_RAIL_BOUNDS, containerWidth),
                  containerWidth
                );
              }}
              onNudge={(deltaX) => {
                const containerWidth = workspaceRef.current?.clientWidth;
                rail.setWidth(
                  resizedWidth(rail.width, deltaX, 'right', WORK_RAIL_BOUNDS, containerWidth),
                  containerWidth
                );
              }}
              onReset={rail.reset}
            />
          </>
        )}

        <div ref={panesRef} className="flex-1 flex min-h-0 min-w-0">
          {panes.map((task, index) => (
            <React.Fragment key={task.id}>
              {index > 0 && !tabbed && (
                <ResizeHandle
                  label={`Resize split between pane ${index} and ${index + 1}`}
                  onDragStart={() => {
                    splitDragStart.current = syncedWeights;
                  }}
                  onDragMove={(deltaX) => {
                    const totalWidth = panesRef.current?.clientWidth || 0;
                    if (totalWidth <= 0) return;
                    setSplitWeights(resizeSplitWeights(splitDragStart.current, index - 1, deltaX / totalWidth));
                  }}
                  onNudge={(deltaX) => {
                    const totalWidth = panesRef.current?.clientWidth || 1000;
                    setSplitWeights((prev) => resizeSplitWeights(prev, index - 1, deltaX / totalWidth));
                  }}
                  onReset={() => setSplitWeights(syncSplitWeights([], panes.length))}
                />
              )}
              <div
                // A class, not the `hidden` attribute: `flex` would win over it.
                className={`min-w-0 min-h-0 ${tabbed && task !== focused ? 'hidden' : 'flex'}`}
                style={
                  tabbed || !split
                    ? { flex: '1 1 0%' }
                    : { flexGrow: syncedWeights[index] ?? 1, flexShrink: 1, flexBasis: 0 }
                }
              >
                <TaskPanel
                  task={task}
                  focusSessionId={open.focusSessionIds[task.id] ?? null}
                  onFocusHandled={open.focusHandled}
                  boardTasks={boardTasks}
                  openTaskIds={open.openTaskIds}
                  split={split}
                  focused={task === focused}
                  narrowWorkspace={narrow}
                  onBack={open.closeAll}
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
                  changedFiles={changedFileCount(changes[task.id], task.changeSummary)}
                  onApplyTask={onApplyTask}
                />
              </div>
            </React.Fragment>
          ))}
        </div>
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
  <div
    role="tablist"
    className="flex shrink-0 overflow-x-auto no-scrollbar border-b border-line bg-[var(--session-rail)] pt-[env(safe-area-inset-top)]"
  >
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
            <span className="font-mono text-[12px] truncate">{task.id}</span>
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
