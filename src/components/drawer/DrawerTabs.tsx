import React from 'react';
import { Tabs } from '@mantine/core';
import { BoardTask, TaskLogItem } from '../../../shared/types';
import { PendingPrompt } from '../../../shared/turns/pendingPrompts';
import { ViewedSession, sessionTabLabel } from '../../../shared/task/viewedSession';
import { openChangelogComments } from '../../../shared/review/changelogComments';
import { sessionTranscript } from '../../../shared/task/logs';
import { DiffView } from '../diff/DiffView';
import { ToolsPanel } from '../tools/ToolsPanel';
import { SessionStream } from '../stream/SessionStream';
import { DrawerTabList } from './DrawerTabList';
import { SessionBanners } from './SessionBanners';
import { DrawerActions } from './drawerActions';
import { EditorOption } from '../../api';

/**
 * The three views of a task: the conversation, what it changed, and what it is
 * allowed to use.
 *
 * Changes and tools are mounted only while open — both cost a read the moment
 * they appear, and the transcript is what the drawer is usually opened for.
 */

interface DrawerTabsProps {
  task: BoardTask;
  /** The session on screen, which may be a side session or a subagent. */
  sessionId?: string;
  view: ViewedSession;
  /** Transcript fetched for a session the board did not send in full. */
  fetchedLogs?: TaskLogItem[];
  /** Prompts sent from here that the transcript does not show yet. */
  pendingPrompts: PendingPrompt[];
  awaitingTranscript: boolean;
  viewedCwd: string;
  tab: string;
  onTabChange: (tab: string) => void;
  actions: DrawerActions;
  primaryEditor?: EditorOption;
  onApplyTask?: (task: BoardTask) => void;
}

export const DrawerTabs: React.FC<DrawerTabsProps> = ({
  task,
  sessionId,
  view,
  fetchedLogs,
  pendingPrompts,
  awaitingTranscript,
  viewedCwd,
  tab,
  onTabChange,
  actions,
  primaryEditor,
  onApplyTask
}) => {
  // One key for every panel: switching session replaces the view rather than
  // updating it, so scroll position and in-flight reads do not carry over.
  const viewKey = `${task.id}-${sessionId || 'main'}`;

  return (
    <Tabs
      value={tab}
      onChange={(value) => onTabChange(value || 'session')}
      className="flex-1 flex flex-col min-h-0"
      classNames={{ panel: 'flex-1 flex flex-col min-h-0', tab: 'drawer-tab' }}
    >
      <DrawerTabList
        sessionCount={view.sessions.length}
        sessionLabel={sessionTabLabel(view)}
        changedFiles={task.changeSummary?.files || 0}
        openCommentCount={openChangelogComments(task.changelogComments).length}
      />

      <Tabs.Panel value="session">
        <SessionBanners view={view} primarySessionId={task.sessionId} onSelectSession={actions.selectSession} />
        {/* cwd lets bare and repo-relative paths in the transcript resolve to real files. */}
        <SessionStream
          key={viewKey}
          logs={sessionTranscript(task.logs, sessionId, fetchedLogs)}
          pending={pendingPrompts}
          loading={awaitingTranscript}
          runState={view.runState}
          cwd={viewedCwd}
          taskId={task.id}
          attribution={{
            model: view.subagent?.model || view.viewed?.model || task.model,
            agent: view.subagent?.agent || view.viewed?.agent || task.agent,
            thinkingLevel: view.viewed?.thinkingLevel || task.thinkingLevel
          }}
          callerLabel={view.isSubagentView ? (view.caller?.label || 'the calling agent') : undefined}
          onOpenSubagent={actions.selectSession}
        />
      </Tabs.Panel>

      <Tabs.Panel value="changes">
        {tab === 'changes' && (
          <DiffView
            key={viewKey}
            taskId={task.id}
            sessionId={sessionId}
            running={view.runState === 'running'}
            comments={task.changelogComments}
            onApplyTask={onApplyTask}
            onOpenFile={primaryEditor ? (path, line, cwd) => actions.openPath(primaryEditor.id, path, line, cwd) : undefined}
          />
        )}
      </Tabs.Panel>

      <Tabs.Panel value="tools">
        {/* Mounted only while open: answering costs an OpenCode read. */}
        {tab === 'tools' && (
          <ToolsPanel key={viewKey} taskId={task.id} sessionId={sessionId} running={view.runState === 'running'} />
        )}
      </Tabs.Panel>
    </Tabs>
  );
};
