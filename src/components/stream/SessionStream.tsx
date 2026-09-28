import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Group, ScrollArea, Stack } from '@mantine/core';
import { Terminal } from 'lucide-react';
import { BoardTask, TaskLogItem } from '../../../shared/types';
import { PendingPrompt, pendingAsLog, streamActivity } from '../../../shared/turns/pendingPrompts';
import { TurnAttribution } from '../../../shared/turns/attribution';
import { FileLinkProvider } from './FileLinks';
import { JumpToMessage } from './JumpToMessage';
import { LogEntry } from './LogEntry';
import { useStreamViewport } from './useStreamViewport';

/** A session's transcript: the log, paginated, pinned to the bottom while it runs. */

interface SessionStreamProps {
  logs: TaskLogItem[];
  /** Prompts sent that the transcript does not show yet, drawn after it. */
  pending?: PendingPrompt[];
  runState: BoardTask['runState'];
  /** Task working directory; without it only absolute `file://` references can be linkified. */
  cwd?: string;
  /** The task this transcript belongs to, sent along when a file link is opened. */
  taskId?: string;
  /** Session-level fallback when a log was streamed before per-turn metadata existed. */
  attribution?: TurnAttribution;
  /** True while the first transcript fetch is still in flight. */
  loading?: boolean;
  /**
   * Set when this transcript belongs to a subagent: the name of the session
   * that called it, which is who its `user_say` turns actually came from.
   */
  callerLabel?: string;
  /** Open the child session a subagent tool call handed its work to. */
  onOpenSubagent?: (sessionId: string) => void;
}

function entryIsStreaming(log: TaskLogItem, runState: BoardTask['runState'], isLast: boolean): boolean {
  if (!isLast || runState !== 'running') return false;
  if (log.type === 'agent_say' || log.type === 'thought') return true;
  if (log.type === 'tool_call') {
    const status = log.toolCall?.status;
    return !status || status === 'pending' || status === 'in_progress';
  }
  return false;
}

const NO_PENDING: PendingPrompt[] = [];

const ACTIVITY_LABEL = { warming: 'Warming up…', thinking: 'Thinking…' } as const;

export const SessionStream: React.FC<SessionStreamProps> = ({
  logs,
  pending = NO_PENDING,
  runState,
  cwd,
  taskId,
  attribution,
  loading,
  callerLabel,
  onOpenSubagent
}) => {
  // Sending is always a reason to look at the bottom, wherever the reader was.
  const view = useStreamViewport(logs, pending[pending.length - 1]?.id);
  const pendingLogs = useMemo(() => pending.map(pendingAsLog), [pending]);
  const activity = streamActivity(pending.length, runState, logs[logs.length - 1]);
  const userMessages = useMemo(() => logs.filter((log) => log.type === 'user_say'), [logs]);

  /**
   * The drawer builds a fresh opener on every render, and handing that straight
   * to a memoised row re-renders every tool call in the transcript. Keep the
   * identity stable and read the current handler through a ref.
   */
  const openSubagentRef = useRef(onOpenSubagent);
  useEffect(() => {
    openSubagentRef.current = onOpenSubagent;
  }, [onOpenSubagent]);
  const openSubagent = useCallback((sessionId: string) => openSubagentRef.current?.(sessionId), []);

  return (
    <FileLinkProvider cwd={cwd} taskId={taskId}>
      <ScrollArea
        viewportRef={view.viewportRef}
        className="flex-1 p-3.5 bg-canvas"
        onScrollPositionChange={view.onScrollPositionChange}
      >
        <Stack gap={10}>
          <Group justify="space-between" className="pb-1 font-mono text-[11px] leading-[1.45] text-ink-3">
            <Group gap={6}>
              <Terminal className="w-3.5 h-3.5" />
              <span>Session</span>
            </Group>
            <Group gap={10}>
              {userMessages.length > 0 && (
                <JumpToMessage messages={userMessages} onJump={view.jumpToMessage} />
              )}
              <span className="tabular-nums">{logs.length} events</span>
            </Group>
          </Group>

          {view.hidden > 0 && (
            <button
              type="button"
              onClick={view.showEarlier}
              className="w-full p-1.5 rounded-md type-ui text-ink-3 hover:bg-surface-2 hover:text-ink-2 transition-colors"
            >
              Show {Math.min(view.pageSize, view.hidden)} earlier ({view.hidden} hidden)
            </button>
          )}

          {view.visible.map((log, index) => {
            const isLast = view.start + index === logs.length - 1;
            return (
              <LogEntry
                key={view.keys[index] ?? log.id}
                log={log}
                isStreaming={entryIsStreaming(log, runState, isLast)}
                fallback={attribution}
                callerLabel={callerLabel}
                onOpenSubagent={onOpenSubagent ? openSubagent : undefined}
              />
            );
          })}

          {pendingLogs.map((log) => (
            <div key={log.id} className="opacity-70">
              <LogEntry log={log} isStreaming={false} fallback={attribution} />
            </div>
          ))}

          {activity && (
            <Group gap={8} className="pl-1 font-mono text-[12px] leading-[1.45] text-ink-3" role="status">
              <span className="w-1.5 h-1.5 rounded-full bg-run animate-pulse" />
              <span>{ACTIVITY_LABEL[activity]}</span>
            </Group>
          )}

          {logs.length === 0 && pendingLogs.length === 0 && (
            <div className="p-4 text-center font-mono text-[12px] leading-[1.45] text-ink-3">
              {loading ? 'Loading transcript…' : 'No events yet'}
            </div>
          )}
        </Stack>
      </ScrollArea>
    </FileLinkProvider>
  );
};
