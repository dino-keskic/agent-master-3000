import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Group, ScrollArea, Stack } from '@mantine/core';
import { Terminal } from 'lucide-react';
import { BoardTask, TaskLogItem } from '../../../shared/types';
import { PendingPrompt, pendingAsLog, streamActivity } from '../../../shared/turns/pendingPrompts';
import { TurnAttribution } from '../../../shared/turns/attribution';
import { FileLinkProvider } from './FileLinks';
import { JumpToMessage } from './JumpToMessage';
import { foldSteps } from '../../../shared/transcript/steps';
import { LogEntry } from './LogEntry';
import { StepsBlock } from './StepsBlock';
import { useStreamViewport } from './useStreamViewport';

/**
 * A session's transcript: the log, paginated, pinned to the bottom while it
 * runs. It reads as a conversation — the tool calls between two messages are
 * folded into one line each (`foldSteps`).
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
  emptyHint,
  callerLabel,
  onOpenSubagent
}) => {
  // Sending is always a reason to look at the bottom, wherever the reader was.
  const view = useStreamViewport(logs, pending[pending.length - 1]?.id);
  const pendingLogs = useMemo(() => pending.map(pendingAsLog), [pending]);
  const activity = streamActivity(pending.length, runState, logs[logs.length - 1]);
  const userMessages = useMemo(() => logs.filter((log) => log.type === 'user_say'), [logs]);
  const blocks = useMemo(() => foldSteps(view.visible), [view.visible]);

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
        className="flex-1 p-3.5"
        onScrollPositionChange={view.onScrollPositionChange}
      >
        <Stack gap={10}>
          <Group justify="space-between" className="pb-1 font-mono text-[12px] leading-[1.45] text-ink-3">
            <Group gap={6}>
              <Terminal className="w-3.5 h-3.5" />
              <span>Session</span>
            </Group>
            <Group gap={10}>
              {userMessages.length > 0 && (
                <JumpToMessage messages={userMessages} onJump={view.jumpToMessage} />
              )}
              <span className="tabular-nums">{userMessages.length} {userMessages.length === 1 ? 'message' : 'messages'} · {logs.length} events</span>
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

          {blocks.map((block) => {
            const entry = (log: TaskLogItem, index: number) => (
              <LogEntry
                key={view.keys[index] ?? log.id}
                log={log}
                isStreaming={entryIsStreaming(log, runState, view.start + index === logs.length - 1)}
                fallback={attribution}
                callerLabel={callerLabel}
                onOpenSubagent={onOpenSubagent ? openSubagent : undefined}
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

          {logs.length === 0 && pendingLogs.length === 0 && (
            <div className="px-4 py-10 text-center text-[13px] leading-[1.5] text-ink-3">
              {loading ? 'Loading the conversation…' : emptyHint || 'Nothing here yet. Send a message below to start this task.'}
            </div>
          )}
        </Stack>
      </ScrollArea>
    </FileLinkProvider>
  );
};
