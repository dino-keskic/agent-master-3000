import React from 'react';
import { Terminal } from 'lucide-react';
import { BoardTask } from '../../../shared/types';
import { BackgroundTaskItem, isExecuteTool, toolCallSummary } from '../../../shared/agent/backgroundTasks';
import { listTaskSessions, sessionRunState } from '../../../shared/task/sessions';
import { relativeTime } from '../../../shared/format';
import { SessionStateDot } from '../session/SessionStateDot';
import { Chip, Surface } from '../ui';

/**
 * One tool call still running. `execute` gets its own running highlight because
 * a shell command is the one people watch for.
 */
export const BackgroundRow: React.FC<{
  item: BackgroundTaskItem;
  task?: BoardTask;
  onOpen: () => void;
}> = ({ item, task, onOpen }) => {
  const summary = toolCallSummary(item.toolCall);
  const execute = isExecuteTool(item.toolCall);
  const session = task && item.sessionId
    ? listTaskSessions(task).find((link) => link.sessionId === item.sessionId)
    : undefined;
  const state = task && session ? sessionRunState(task, session) : 'running';

  return (
    <Surface
      level="s1"
      variant={execute ? 'running' : 'default'}
      radius="lg"
      interactive
      className="p-3 flex flex-col gap-2"
      onClick={onOpen}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <SessionStateDot state={state} />
          {execute && <Terminal className="w-3.5 h-3.5 text-run-fg shrink-0" />}
          <Chip className="font-mono shrink-0">{item.taskId}</Chip>
          <span className="font-mono text-[12.5px] font-semibold text-ink truncate">
            {item.toolCall.name}
          </span>
        </div>
        <Chip tone="run" className="shrink-0">
          {item.toolCall.status === 'pending' ? 'Pending' : 'Running'}
        </Chip>
      </div>

      {summary && (
        <div className="font-mono text-[12px] text-ink-2 truncate bg-code px-2 py-1 rounded border border-hairline">
          {summary}
        </div>
      )}

      <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-ink-3 font-mono">
        <span className="truncate max-w-[200px]">{item.taskTitle}</span>
        {item.sessionTitle && item.sessionTitle !== item.taskTitle && <span>· {item.sessionTitle}</span>}
        {item.projectName && <span>· {item.projectName}</span>}
        <span>· started {relativeTime(item.startedAt)}</span>
      </div>
    </Surface>
  );
};
