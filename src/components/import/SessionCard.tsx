import React from 'react';
import { Checkbox, Tooltip } from '@mantine/core';
import { Bot, Cpu, Download, Folder, GitBranch, Users } from 'lucide-react';
import { AcpSessionSummary } from '../../../shared/sessions/types';
import { formatTokenCount, isLiveSession } from '../../../shared/sessions/list';
import { relativeTime, shortModelLabel, shortPath } from '../../../shared/format';
import { SpendLabel } from '../spend/SpendLabel';
import { Button, Chip, Surface } from '../ui';

/** What the session is: live, changed, which project, which worktree. */
const SessionTags: React.FC<{ session: AcpSessionSummary }> = ({ session }) => {
  const isGone = session.cwdExists === false;
  const isLive = isLiveSession(session) || !!session.cwdDirty;
  return (
    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
      <span className="text-[13.5px] font-semibold text-ink truncate max-w-[520px]" title={session.title}>
        {session.title}
      </span>

      <Chip className="font-mono text-ink-3 shrink-0">
        {session.sessionId.slice(0, 14)}
      </Chip>

      {isLive && !session.importedAsTaskId && (
        <Chip tone="run" className="font-mono shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-run inline-block" />
          live
        </Chip>
      )}

      {session.changeSummary && (
        <Chip className="font-mono shrink-0">
          <span className="text-add">+{session.changeSummary.additions}</span>
          <span className="text-del">-{session.changeSummary.deletions}</span>
        </Chip>
      )}

      {session.cwdDirty && (
        <Chip tone="wait" className="font-mono shrink-0">
          uncommitted
        </Chip>
      )}

      {session.projectName && (
        <Chip className="font-mono shrink-0">{session.projectName}</Chip>
      )}

      {session.isWorktree && session.worktreeLabel && (
        <Chip tone={isGone ? 'err' : 'accent'} className="font-mono shrink-0">
          <GitBranch className="w-3 h-3" />
          {isGone ? `gone · ${session.worktreeLabel}` : session.worktreeLabel}
        </Chip>
      )}
    </div>
  );
};

/** Where it ran and what it cost: folder, model, agent, spend, size, age. */
const SessionMeta: React.FC<{ session: AcpSessionSummary }> = ({ session }) => (
  <div className="flex items-center gap-3 flex-wrap text-[12px] font-mono text-ink-3">
    <div className="flex items-center gap-1 min-w-0 max-w-[280px]">
      <Folder className="w-3.5 h-3.5 text-ink-4 shrink-0" />
      <Tooltip label={session.cwd} withArrow>
        <span className="truncate">{shortPath(session.cwd)}</span>
      </Tooltip>
    </div>

    {session.model && (
      <div className="flex items-center gap-1">
        <Cpu className="w-3 h-3 text-ink-4" />
        <span>{shortModelLabel(session.model)}</span>
      </div>
    )}

    {session.agent && (
      <div className="flex items-center gap-1">
        <Bot className="w-3 h-3 text-ink-4" />
        <span>{session.agent}</span>
      </div>
    )}

    {!!session.subagentCount && session.subagentCount > 0 && (
      <div className="flex items-center gap-1 text-acc-fg">
        <Users className="w-3 h-3" />
        <span>
          {session.subagentCount} subagent{session.subagentCount === 1 ? '' : 's'}
        </span>
      </div>
    )}

    <SpendLabel
      cost={session.cost}
      contextTokens={session.contextTokens}
      contextLimit={session.contextLimit}
      subagentCount={session.subagentCount}
    />

    {!!session.tokenCount && session.tokenCount > 0 && (
      <span>{formatTokenCount(session.tokenCount)}</span>
    )}

    <Tooltip label={`Updated ${new Date(session.updatedAt).toLocaleString()}`} withArrow>
      <span className="text-ink-4 shrink-0">· {relativeTime(session.updatedAt)}</span>
    </Tooltip>
  </div>
);

interface SessionCardProps {
  session: AcpSessionSummary;
  isSelected: boolean;
  isBusy: boolean;
  /** A bulk import is running; single-session actions are out of bounds. */
  bulkActive: boolean;
  onToggle: () => void;
  onImport: () => void;
}

/** One OpenCode session as a row in the import list. */
export const SessionCard: React.FC<SessionCardProps> = ({
  session,
  isSelected,
  isBusy,
  bulkActive,
  onToggle,
  onImport
}) => {
  const alreadyImported = !!session.importedAsTaskId;
  const selectable = !alreadyImported && !bulkActive;

  return (
    <Surface
      level="s1"
      border={isSelected ? 'accent' : 'default'}
      radius="lg"
      interactive={selectable}
      onClick={() => {
        if (selectable) onToggle();
      }}
      className={`p-3 flex items-start justify-between gap-3 transition-colors ${
        isSelected
          ? 'bg-acc-bg/60'
          : alreadyImported
            ? 'opacity-65'
            : ''
      }`}
    >
      <Checkbox
        size="xs"
        className="mt-1 shrink-0 pointer-events-none"
        checked={isSelected}
        onChange={onToggle}
        disabled={!selectable}
      />

      <div className="flex flex-col gap-1.5 min-w-0 flex-1">
        <SessionTags session={session} />
        <SessionMeta session={session} />
      </div>

      <div className="shrink-0 pt-0.5" onClick={(e) => e.stopPropagation()}>
        {alreadyImported ? (
          <Chip className="font-mono font-semibold">{session.importedAsTaskId}</Chip>
        ) : (
          <Button
            size="xs"
            variant="secondary"
            loading={isBusy}
            disabled={bulkActive || isBusy}
            onClick={onImport}
            leftSection={<Download className="w-3 h-3" />}
          >
            Import
          </Button>
        )}
      </div>
    </Surface>
  );
};
