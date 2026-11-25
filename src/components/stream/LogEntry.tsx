import { memo, useState } from 'react';
import { Tooltip } from '@mantine/core';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  GitFork,
  Paperclip,
  Sparkles,
  Users
} from 'lucide-react';
import { TaskLogItem } from '../../../shared/types';
import { MentionExtra, splitMentionBlocks } from '../../../shared/trackers/mentions';
import { leadingSlashCommand } from '../../../shared/composer/slashCommands';
import { formatTurnAttribution, TurnAttribution } from '../../../shared/turns/attribution';
import { ForkMode, forkableMessageId } from '../../../shared/transcript/forkPoint';
import { ToolCallBlock } from './ToolCallBlock';
import { ReasoningBlock } from './ReasoningBlock';
import { LogImages } from './LogImages';
import { Markdown } from './Markdown';
import { SkillChip } from './SkillChip';
import { Surface } from '../ui';

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
        className="flex items-center gap-1.5 w-full px-2 py-1.5 text-left font-mono text-[12px] leading-[1.45] text-ink-3 hover:text-ink transition-colors"
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

/**
 * Quiet action strip sitting directly underneath a chat message — the familiar
 * Copy / Fork bar from modern AI chat UIs. Hidden until hovered on older turns
 * so long transcripts stay clean, and gently visible on the latest answer or
 * the active branch anchor.
 */
function MessageActions({
  text,
  align = 'start',
  alwaysVisible = false,
  canFork,
  forkLabel,
  forkTooltip,
  onFork
}: {
  text: string;
  align?: 'start' | 'end';
  alwaysVisible?: boolean;
  canFork: boolean;
  forkLabel: string;
  forkTooltip: string;
  onFork?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    if (!text) return;
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };

  return (
    <div
      className={`msg-actions flex items-center gap-0.5 pt-1 px-0.5 transition-opacity ${
        align === 'end' ? 'justify-end' : 'justify-start'
      } ${
        alwaysVisible
          ? 'opacity-80 group-hover/msg:opacity-100'
          : 'opacity-0 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100'
      }`}
    >
      {text && (
        <Tooltip label={copied ? 'Copied' : 'Copy'} withArrow>
          <button
            type="button"
            aria-label="Copy message"
            onClick={handleCopy}
            className="h-6 px-1.5 rounded-md text-[11.5px] text-ink-4 hover:text-ink hover:bg-s3h inline-flex items-center gap-1 transition-colors"
          >
            {copied ? <Check className="w-3 h-3 text-run-fg" /> : <Copy className="w-3 h-3" />}
          </button>
        </Tooltip>
      )}
      {canFork && onFork && (
        <Tooltip label={forkTooltip} withArrow>
          <button
            type="button"
            onClick={onFork}
            className="h-6 px-1.5 rounded-md text-[11.5px] text-ink-4 hover:text-link hover:bg-s3h inline-flex items-center gap-1 transition-colors"
          >
            <GitFork className="w-3 h-3" />
            <span>{forkLabel}</span>
          </button>
        </Tooltip>
      )}
    </div>
  );
}

function BranchMarker() {
  return (
    <div className="flex items-center gap-2 pt-1.5 text-[11px] font-mono text-link">
      <span className="flex-1 h-px bg-link-bd" />
      <span className="inline-flex items-center gap-1 shrink-0">
        <GitFork className="w-3 h-3" />
        Branch point — later messages stay in this session
      </span>
      <span className="flex-1 h-px bg-link-bd" />
    </div>
  );
}

export const LogEntry = memo(function LogEntry({
  log,
  isStreaming,
  isLatestAgent = false,
  isForkAnchor = false,
  fallback,
  callerLabel,
  onOpenSubagent,
  onForkLog
}: {
  log: TaskLogItem;
  isStreaming: boolean;
  /** True on the newest completed assistant turn so its action bar stays easy to spot. */
  isLatestAgent?: boolean;
  /** True while the composer is anchored to fork from this entry. */
  isForkAnchor?: boolean;
  fallback?: TurnAttribution;
  /** Set when this transcript is a subagent's: who wrote its `user_say` turns. */
  callerLabel?: string;
  onOpenSubagent?: (sessionId: string) => void;
  onForkLog?: (log: TaskLogItem, mode: ForkMode) => void;
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
    const canFork = !!onForkLog && !isStreaming && !!forkableMessageId(log);
    return (
      <div id={`log-${log.id}`} className="group/msg scroll-mt-3 min-w-0">
        <div
          className={`rounded-xl border px-3 py-2.5 sm:px-4 sm:py-3 bg-[var(--session-agent-bg)] border-[var(--session-agent-bd)] min-w-0 overflow-hidden ${
            isForkAnchor ? 'ring-1 ring-link/60 !border-link/50' : ''
          }`}
        >
          <div className="flex items-center gap-1.5 mb-1.5">
            <Sparkles className="w-3 h-3 shrink-0 text-link" />
            <span className="text-[11.5px] font-medium text-ink-2 truncate">
              Agent{who ? <span className="font-normal text-ink-3"> · {who}</span> : null}
            </span>
            {isStreaming && <span className="w-1.5 h-1.5 rounded-full bg-run animate-pulse ml-1" />}
          </div>
          <LogImages images={log.images} />
          <div className="text-ink">
            <Markdown>{log.text}</Markdown>
          </div>
        </div>
        {!isStreaming && (
          <MessageActions
            text={log.text}
            alwaysVisible={isLatestAgent || isForkAnchor}
            canFork={canFork}
            forkLabel="Fork"
            forkTooltip="Fork a new session starting after this message"
            onFork={() => onForkLog?.(log, 'after')}
          />
        )}
        {isForkAnchor && <BranchMarker />}
      </div>
    );
  }

  if (log.type === 'user_say') {
    // A message sent as `/skill …` leads with the skill, marked as one, so a
    // transcript shows at a glance which turns ran a skill or command.
    const command = leadingSlashCommand(log.text || '');
    const body = command ? command.rest : log.text || '';
    const canFork = !!onForkLog && !callerLabel && !!forkableMessageId(log);
    return (
      // id is the jump target for the turns jump menu.
      <div id={`log-${log.id}`} className="group/msg ml-3 sm:ml-8 scroll-mt-3 min-w-0">
        <div
          className={`rounded-xl border px-3 py-2 sm:px-3.5 sm:py-2.5 bg-[var(--session-user-bg)] border-[var(--session-user-bd)] min-w-0 overflow-hidden ${
            isForkAnchor ? 'ring-1 ring-link/60' : ''
          }`}
        >
          {callerLabel && (
            <div className="flex items-center gap-1.5 mb-1">
              <Users className="w-3 h-3 shrink-0 text-link" />
              <span className="text-[11.5px] truncate font-semibold text-link">
                Prompt from {callerLabel}
              </span>
            </div>
          )}
          <LogImages images={log.images} />
          {command && (
            <div className={body.trim() ? 'mb-1' : ''}>
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
        </div>
        <MessageActions
          text={log.text}
          align="end"
          alwaysVisible={isForkAnchor}
          canFork={canFork}
          forkLabel="Fork & edit"
          forkTooltip="Fork before this prompt and edit it in the composer"
          onFork={() => onForkLog?.(log, 'before')}
        />
        {isForkAnchor && <BranchMarker />}
      </div>
    );
  }

  if (log.type === 'error') {
    return (
      <Surface variant="error" radius="md" className="p-3">
        <div className="flex items-center gap-1.5 mb-1.5 font-mono text-[12px] font-medium uppercase tracking-[0.08em] text-err-fg">
          <AlertCircle className="w-3.5 h-3.5" />
          {log.title || 'Error'}
        </div>
        <div className="font-mono text-[12px] leading-[1.5] text-ink-2 whitespace-pre-wrap">{log.text}</div>
      </Surface>
    );
  }

  return (
    <div className="py-0.5 px-1 text-[12px] leading-[1.45] text-ink-4">
      {log.text}
    </div>
  );
});
