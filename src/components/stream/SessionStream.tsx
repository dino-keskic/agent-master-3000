import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Group, ScrollArea, Stack } from '@mantine/core';
import { BoardTask, TaskLogItem } from '../../../shared/types';
import { PendingPrompt, pendingAsLog, streamActivity } from '../../../shared/turns/pendingPrompts';
import { TurnAttribution } from '../../../shared/turns/attribution';
import { ForkMode, isNoiseLog } from '../../../shared/transcript/forkPoint';
import { FileLinkProvider } from './FileLinks';
import { foldSteps } from '../../../shared/transcript/steps';
import { LogEntry } from './LogEntry';
import { StepsBlock } from './StepsBlock';
import { useStreamViewport } from './useStreamViewport';

/**
 * A session's transcript: the log, paginated, pinned to the bottom while it
 * runs. Routine lifecycle chatter is filtered out, and tool calls between two
 * messages fold into one line each (`foldSteps`).
 */

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
  /** What an empty transcript says, in place of "Nothing here yet". */
  emptyHint?: string;
  /**
   * Set when this transcript belongs to a subagent: the name of the session
   * that called it, which is who its `user_say` turns actually came from.
   */
  callerLabel?: string;
  /** Log id currently anchored for a mid-session fork. */
  forkAnchorLogId?: string;
  /** Open the child session a subagent tool call handed its work to. */
  onOpenSubagent?: (sessionId: string) => void;
  /** Start a fork anchored at a specific message in this stream. */
  onForkLog?: (log: TaskLogItem, mode: ForkMode) => void;
  /** Receives this stream's jump handler so the tab bar can jump directly into it. */
  jumpRef?: React.MutableRefObject<((log: TaskLogItem) => void) | null>;
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
  emptyHint,
  callerLabel,
  forkAnchorLogId,
  onOpenSubagent,
  onForkLog,
  jumpRef
}) => {
  const cleanLogs = useMemo(() => logs.filter((log) => !isNoiseLog(log)), [logs]);
  // Sending is always a reason to look at the bottom, wherever the reader was.
  const view = useStreamViewport(cleanLogs, pending[pending.length - 1]?.id);
  const pendingLogs = useMemo(() => pending.map(pendingAsLog), [pending]);
  const activity = streamActivity(pending.length, runState, cleanLogs[cleanLogs.length - 1]);
  const blocks = useMemo(() => foldSteps(view.visible), [view.visible]);

  const latestAgentId = useMemo(() => {
    for (let i = cleanLogs.length - 1; i >= 0; i--) {
      if (cleanLogs[i]!.type === 'agent_say') return cleanLogs[i]!.id;
    }
    return undefined;
  }, [cleanLogs]);

  // Expose the viewport's jump handler to the tab bar without extra renders.
  useEffect(() => {
    if (!jumpRef) return;
    jumpRef.current = view.jumpToMessage;
    return () => {
      jumpRef.current = null;
    };
  }, [jumpRef, view.jumpToMessage]);

  /**
   * Keep callback identities stable across renders so memoised `LogEntry` rows
   * do not re-render on every status tick.
   */
  const openSubagentRef = useRef(onOpenSubagent);
  useEffect(() => {
    openSubagentRef.current = onOpenSubagent;
  }, [onOpenSubagent]);
  const openSubagent = useCallback((sessionId: string) => openSubagentRef.current?.(sessionId), []);

  const forkLogRef = useRef(onForkLog);
  useEffect(() => {
    forkLogRef.current = onForkLog;
  }, [onForkLog]);
  const forkLog = useCallback((log: TaskLogItem, mode: ForkMode) => forkLogRef.current?.(log, mode), []);

  return (
    <FileLinkProvider cwd={cwd} taskId={taskId}>
      <ScrollArea
        viewportRef={view.viewportRef}
        className="flex-1 px-2.5 sm:px-3.5 py-2 sm:py-2.5"
        classNames={{ viewport: 'overflow-x-hidden' }}
        onScrollPositionChange={view.onScrollPositionChange}
      >
        <Stack gap={8} className="min-w-0">
          {view.hidden > 0 && (
            <button
              type="button"
              onClick={view.showEarlier}
              className="w-full p-1.5 rounded-md type-ui text-ink-3 hover:bg-surface-2 hover:text-ink-2 transition-colors"
            >
              Show {Math.min(view.pageSize, view.hidden)} earlier ({view.hidden} hidden)
            </button>
          )}

          {blocks.map((block) => {
            const entry = (log: TaskLogItem, index: number) => (
              <LogEntry
                key={view.keys[index] ?? log.id}
                log={log}
                isStreaming={entryIsStreaming(log, runState, view.start + index === cleanLogs.length - 1)}
                isLatestAgent={log.id === latestAgentId}
                isForkAnchor={!!forkAnchorLogId && forkAnchorLogId === log.id}
                fallback={attribution}
                callerLabel={callerLabel}
                onOpenSubagent={onOpenSubagent ? openSubagent : undefined}
                onForkLog={onForkLog ? forkLog : undefined}
              />
            );
            if (block.kind === 'entry') return entry(block.log, block.index);
            const live = block.live && runState === 'running';
            const current = block.logs[block.logs.length - 1]?.toolCall;
            return (
              <StepsBlock
                key={`steps-${view.keys[block.index] ?? block.id}`}
                summary={block.summary}
                live={live}
                liveLabel={current?.name}
                failed={block.failed}
              >
                {block.logs.map((log, offset) => entry(log, block.index + offset))}
              </StepsBlock>
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

          {cleanLogs.length === 0 && pendingLogs.length === 0 && (
            <div className="px-4 py-10 text-center text-[13px] leading-[1.5] text-ink-3">
              {loading ? 'Loading the conversation…' : emptyHint || 'Nothing here yet. Send a message below to start this task.'}
            </div>
          )}
        </Stack>
      </ScrollArea>
    </FileLinkProvider>
  );
};
