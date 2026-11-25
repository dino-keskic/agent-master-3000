import React, { useMemo, useRef } from 'react';
import { Tabs } from '@mantine/core';
import { OpenCodeModel } from '../../../shared/sessions/types';
import { BoardTask, TaskLogItem } from '../../../shared/types';
import { PendingPrompt } from '../../../shared/turns/pendingPrompts';
import { ViewedSession, sessionTabLabel } from '../../../shared/task/viewedSession';
import { openChangelogComments } from '../../../shared/review/changelogComments';
import { ForkMode } from '../../../shared/transcript/forkPoint';
import { AgentsPanel } from '../agents/AgentsPanel';
import { DiffView } from '../diff/DiffView';
import { SkillsPanel } from '../skills/SkillsPanel';
import { ToolsPanel } from '../tools/ToolsPanel';
import { JumpToMessage } from '../stream/JumpToMessage';
import { SessionStream } from '../stream/SessionStream';
import { DrawerTabList } from './DrawerTabList';
import { SessionBanners } from './SessionBanners';
import { DrawerActions } from './drawerActions';
import { EditorOption } from '../../api';

/**
 * The views of a task: the conversation, what it changed, and its config
 * studios (tools, agents, skills).
 *
 * Changes and config panels are mounted only while open — they cost a read
 * when opened, and the transcript is what the drawer is usually opened for.
 */

interface DrawerTabsProps {
  task: BoardTask;
  /** The manager has nothing to diff and no tools of its own to list. */
  conversationOnly?: boolean;
  /** The session on screen, which may be a side session or a subagent. */
  sessionId?: string;
  view: ViewedSession;
  /** Whether the right details sidebar is visible (avoids duplicating session count). */
  sidebarOpen?: boolean;
  /** The transcript on screen (`drawerTranscript`). */
  logs: TaskLogItem[];
  /** Prompts sent from here that the transcript does not show yet. */
  pendingPrompts: PendingPrompt[];
  awaitingTranscript: boolean;
  viewedCwd: string;
  tab: string;
  onTabChange: (tab: string) => void;
  actions: DrawerActions;
  primaryEditor?: EditorOption;
  /** Files the task has changed, counted the way the board's cards count them. */
  changedFiles: number;
  models: OpenCodeModel[];
  /** Log id currently anchored for a mid-session fork. */
  forkAnchorLogId?: string;
  onForkLog?: (log: TaskLogItem, mode: ForkMode) => void;
  onUseAgent?: (agentId: string) => void;
  onInsertSkill?: (name: string) => void;
  onApplyTask?: (task: BoardTask) => void;
}

export const DrawerTabs: React.FC<DrawerTabsProps> = ({
  task,
  conversationOnly = false,
  sessionId,
  view,
  sidebarOpen = true,
  logs,
  pendingPrompts,
  awaitingTranscript,
  viewedCwd,
  tab,
  onTabChange,
  actions,
  primaryEditor,
  changedFiles,
  models,
  forkAnchorLogId,
  onForkLog,
  onUseAgent,
  onInsertSkill,
  onApplyTask
}) => {
  // One key for every panel: switching session replaces the view rather than
  // updating it, so scroll position and in-flight reads do not carry over.
  const viewKey = `${task.id}-${sessionId || 'main'}`;
  const jumpRef = useRef<((log: TaskLogItem) => void) | null>(null);
  const userMessages = useMemo(() => logs.filter((log) => log.type === 'user_say'), [logs]);
  const activeTab = conversationOnly ? 'session' : tab;

  return (
    <Tabs
      value={activeTab}
      onChange={(value) => onTabChange(value || 'session')}
      className="flex-1 flex flex-col min-h-0"
      classNames={{ panel: 'flex-1 flex flex-col min-h-0', tab: 'drawer-tab' }}
    >
      {!conversationOnly && (
        <DrawerTabList
          sessionCount={view.sessions.length}
          sidebarOpen={sidebarOpen}
          sessionLabel={sessionTabLabel(view)}
          changedFiles={changedFiles}
          openCommentCount={openChangelogComments(task.changelogComments).length}
          rightSlot={
            activeTab === 'session' && userMessages.length > 0 ? (
              <JumpToMessage messages={userMessages} onJump={(log) => jumpRef.current?.(log)} />
            ) : undefined
          }
        />
      )}

      <Tabs.Panel value="session">
        <SessionBanners view={view} primarySessionId={task.sessionId} onSelectSession={actions.selectSession} />
        {/* cwd lets bare and repo-relative paths in the transcript resolve to real files. */}
        <SessionStream
          key={viewKey}
          logs={logs}
          pending={pendingPrompts}
          loading={awaitingTranscript}
          emptyHint={conversationOnly ? 'Ask the manager what needs you, or what changed since you last looked.' : undefined}
          runState={view.runState}
          cwd={viewedCwd}
          taskId={task.id}
          attribution={{
            model: view.subagent?.model || view.viewed?.model || task.model,
            agent: view.subagent?.agent || view.viewed?.agent || task.agent,
            thinkingLevel: view.viewed?.thinkingLevel || task.thinkingLevel
          }}
          callerLabel={view.isSubagentView ? (view.caller?.label || 'the calling agent') : undefined}
          forkAnchorLogId={forkAnchorLogId}
          onOpenSubagent={actions.selectSession}
          onForkLog={!conversationOnly && !view.isSubagentView ? onForkLog : undefined}
          jumpRef={jumpRef}
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

      <Tabs.Panel value="agents">
        {tab === 'agents' && (
          <AgentsPanel
            key={viewKey}
            taskId={task.id}
            sessionId={sessionId}
            activeAgent={view.viewed?.chosen?.agent || view.viewed?.agent || task.agent}
            models={models}
            onUseAgent={onUseAgent}
          />
        )}
      </Tabs.Panel>

      <Tabs.Panel value="skills">
        {tab === 'skills' && (
          <SkillsPanel
            key={viewKey}
            taskId={task.id}
            sessionId={sessionId}
            onInsertSkill={onInsertSkill}
          />
        )}
      </Tabs.Panel>
    </Tabs>
  );
};
