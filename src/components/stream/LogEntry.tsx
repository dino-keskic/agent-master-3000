import { memo, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Paperclip,
  Sparkles,
  Users
} from 'lucide-react';
import { TaskLogItem } from '../../../shared/types';
import { MentionExtra, splitMentionBlocks } from '../../../shared/trackers/mentions';
import { leadingSlashCommand } from '../../../shared/composer/slashCommands';
import { formatTurnAttribution, TurnAttribution } from '../../../shared/turns/attribution';
import { ToolCallBlock } from './ToolCallBlock';
import { ReasoningBlock } from './ReasoningBlock';
import { LogImages } from './LogImages';
import { Markdown } from './Markdown';
import { SkillChip } from './SkillChip';
import { Surface, Type } from '../ui';

/** One line of a transcript, whatever kind of thing it turned out to be. */

function attributionOf(log: TaskLogItem, fallback?: TurnAttribution): TurnAttribution {
  return {
    model: typeof log.metadata?.model === 'string' ? log.metadata.model : fallback?.model,
    agent: typeof log.metadata?.agent === 'string' ? log.metadata.agent : fallback?.agent,
    thinkingLevel: typeof log.metadata?.thinkingLevel === 'string' ? log.metadata.thinkingLevel : fallback?.thinkingLevel
  };
}

/**
 * One block the composer attached to a turn — a ticket description, a comment
 * thread, a CI run. All of it went to the agent and all of it is in the log;
 * it stays folded here because a transcript where every ticket is a wall of
 * text is one nobody can read.
 */
function AttachedContext({ id, extra, body }: { id: string; extra: MentionExtra; body: string }) {
  const [open, setOpen] = useState(false);
  const lines = body.split('\n').length;
  return (
    <Surface level="s2" border="default" radius="sm" className="mt-2 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex items-center gap-1.5 w-full px-2 py-1.5 text-left font-mono text-[11px] leading-[1.45] text-ink-3 hover:text-ink transition-colors"
      >
        {open ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
        <Paperclip className="w-3 h-3 shrink-0 text-acc-fg" />
        <span className="truncate">{id} {extra}</span>
        <span className="ml-auto shrink-0 tabular-nums text-ink-4">{lines} line{lines === 1 ? '' : 's'}</span>
      </button>
      {open && (
        <div className="px-3 pb-2.5 pt-1.5 border-t border-hairline bg-code">
          <Markdown>{body}</Markdown>
        </div>
      )}
    </Surface>
  );
}

export const LogEntry = memo(function LogEntry({
  log,
  isStreaming,
  fallback,
  callerLabel,
  onOpenSubagent
}: {
  log: TaskLogItem;
  isStreaming: boolean;
  fallback?: TurnAttribution;
  /** Set when this transcript is a subagent's: who wrote its `user_say` turns. */
  callerLabel?: string;
  onOpenSubagent?: (sessionId: string) => void;
}) {
  if (log.type === 'thought') {
    if (!log.text.trim()) return null;
    return (
      <ReasoningBlock
        text={log.text}
        isStreaming={isStreaming}
        durationMs={typeof log.metadata?.durationMs === 'number' ? log.metadata.durationMs : undefined}
      />
    );
  }

  if (log.type === 'tool_call') {
    if (!log.toolCall) {
      if (!log.text.trim() && (!log.title || log.title === 'Tool: Tool Execution')) return null;
      return (
        <Surface level="s2" border="default" radius="md" className="px-2.5 py-1.5 font-mono text-xs text-ink-3">
          {log.title || 'Tool'}
        </Surface>
      );
    }
    return <ToolCallBlock info={log.toolCall} timestamp={log.timestamp} onOpenSubagent={onOpenSubagent} />;
  }

  if (log.type === 'agent_say') {
    const who = formatTurnAttribution(attributionOf(log, fallback));
    return (
      <Surface level="s3" border="default" radius="md" className="p-3">
        <div className="flex items-center gap-1.5 mb-1.5">
          <Sparkles className="w-3 h-3 shrink-0 text-ink-3" />
          <Type role="meta" className="truncate font-medium">
            Agent{who ? <span className="font-normal text-ink-4"> · {who}</span> : null}
          </Type>
          {isStreaming && <span className="w-1.5 h-1.5 rounded-full bg-run animate-pulse ml-1" />}
        </div>
        <div className="text-ink">
          <Markdown>{log.text}</Markdown>
        </div>
      </Surface>
    );
  }

  if (log.type === 'user_say') {
    // A message sent as `/skill …` leads with the skill, marked as one, so a
    // transcript shows at a glance which turns ran a skill or command.
    const command = leadingSlashCommand(log.text || '');
    const body = command ? command.rest : log.text || '';
    return (
      // id is the jump target for the "jump to message" menu below.
      <div id={`log-${log.id}`} className="ml-6 scroll-mt-3">
        <Surface level="s0" border="default" radius="md" className="p-3">
          {/* Nobody typed this one in a subagent session — the caller did. */}
          <div className="flex items-center gap-1.5 mb-1.5">
            {callerLabel ? <Users className="w-3 h-3 shrink-0" /> : <MessageSquare className="w-3 h-3 shrink-0" />}
            <Type role="meta" className="truncate font-medium">{callerLabel ? `Prompt from ${callerLabel}` : 'You'}</Type>
          </div>
          <LogImages images={log.images} />
          {command && (
            <div className={body.trim() ? 'mb-1.5' : ''}>
              <SkillChip name={command.name} slash />
            </div>
          )}
          <div className="text-ink">
            {splitMentionBlocks(body).map((segment, index) =>
              segment.kind === 'text' ? (
                <Markdown key={index}>{segment.text}</Markdown>
              ) : (
                <AttachedContext key={index} id={segment.id} extra={segment.extra} body={segment.body} />
              )
            )}
          </div>
        </Surface>
      </div>
    );
  }

  if (log.type === 'error') {
    return (
      <Surface variant="error" radius="md" className="p-3">
        <div className="flex items-center gap-1.5 mb-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-err-fg">
          <AlertCircle className="w-3.5 h-3.5" />
          {log.title || 'Error'}
        </div>
        <div className="font-mono text-[12px] leading-[1.5] text-ink-2 whitespace-pre-wrap">{log.text}</div>
      </Surface>
    );
  }

  return (
    <div className="py-0.5 px-1 type-meta-line text-ink-4">
      {log.text}
    </div>
  );
});
