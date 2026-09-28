import { useEffect, useState } from 'react';
import { Group, Tooltip } from '@mantine/core';
import { elapsed } from '../../../../shared/format';
import { ToolCallInfo } from '../../../../shared/types';
import { skillNameOf, summarizeToolCall } from '../../../../shared/agent/toolCallView';
import { SkillChip } from '../SkillChip';
import { STATUS_STYLES } from './styles';
import {
  Search, FileText, FilePen, Terminal, Globe, Brain, Wrench, Trash2,
  Check, X, Loader2, Circle, Users, CornerDownRight, WandSparkles
} from 'lucide-react';

/** ACP `kind` -> icon. Falls back to a generic wrench for unknown kinds. */
function kindIcon(kind?: string, name?: string) {
  const key = (kind || name || '').toLowerCase();
  const cls = 'w-3.5 h-3.5';
  if (key.includes('search') || key.includes('glob') || key.includes('grep')) return <Search className={cls} />;
  if (key.includes('edit') || key.includes('write') || key.includes('patch')) return <FilePen className={cls} />;
  if (key.includes('fetch') || key.includes('web')) return <Globe className={cls} />;
  if (key.includes('read') || key.includes('file')) return <FileText className={cls} />;
  if (key.includes('execute') || key.includes('bash') || key.includes('shell')) return <Terminal className={cls} />;
  if (key.includes('think')) return <Brain className={cls} />;
  if (key.includes('delete')) return <Trash2 className={cls} />;
  return <Wrench className={cls} />;
}

function LiveElapsed({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <>{elapsed(startedAt, now)}</>;
}

function StatusIcon({ status }: { status: ToolCallInfo['status'] }) {
  switch (status) {
    case 'in_progress':
      return <Loader2 className="w-3.5 h-3.5 text-run-fg animate-spin" />;
    case 'completed':
      return <Check className="w-3.5 h-3.5 text-ink-3" />;
    case 'failed':
      return <X className="w-3.5 h-3.5 text-err-fg" />;
    default:
      return <Circle className="w-3 h-3 text-ink-4" />;
  }
}

/**
 * The always-visible line: what was called, on what, how it went and when.
 * `opensChild` marks the calls that stand for a whole session of their own.
 */
export function ToolCallRow({
  info,
  timestamp,
  opensChild
}: {
  info: ToolCallInfo;
  timestamp: number;
  opensChild: boolean;
}) {
  const style = STATUS_STYLES[info.status];
  const skill = skillNameOf(info);
  const summary = summarizeToolCall(info);

  return (
    <Group gap={8} wrap="nowrap" justify="space-between" className="w-full">
      <Group gap={8} wrap="nowrap" className="min-w-0 flex-1">
        {skill !== undefined ? (
          // A skill changes how the agent works for the rest of the turn, so
          // it is marked in the accent rather than filed among the reads.
          <span className="text-acc-fg shrink-0"><WandSparkles className="w-3.5 h-3.5" /></span>
        ) : (
          <span className={`${style.color} shrink-0`}>{kindIcon(info.kind, info.name)}</span>
        )}
        <span className="tool-name font-mono font-medium text-ink shrink-0">
          {info.name}
        </span>
        {skill && <SkillChip name={skill} />}
        {opensChild && info.subagentName && (
          <span className="tool-name font-mono text-acc-fg shrink-0">{info.subagentName}</span>
        )}
        {summary && (
          <span className="tool-name font-mono text-ink-3 truncate min-w-0" title={summary}>
            {summary}
          </span>
        )}
      </Group>

      <Group gap={6} wrap="nowrap" className="shrink-0">
        {opensChild && (
          <span className="flex items-center gap-1 text-acc-fg">
            <Users className="w-3 h-3" />
            <CornerDownRight className="w-3 h-3" />
          </span>
        )}
        {info.status === 'in_progress' ? (
          <span className="type-meta text-run-fg tabular-nums">
            running <LiveElapsed startedAt={timestamp} />
          </span>
        ) : (
          <>
            <Tooltip label={style.label} withArrow position="left">
              <span className="flex items-center"><StatusIcon status={info.status} /></span>
            </Tooltip>
            <span className="type-meta text-ink-3">
              {new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </>
        )}
      </Group>
    </Group>
  );
}
