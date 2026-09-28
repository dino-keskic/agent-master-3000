import React from 'react';
import { Badge, Button, Checkbox, Group, Paper, Stack, Text, Tooltip } from '@mantine/core';
import { Bot, Cpu, Download, Folder, GitBranch, Users } from 'lucide-react';
import { AcpSessionSummary } from '../../../shared/sessions/types';
import { formatTokenCount, isLiveSession } from '../../../shared/sessions/list';
import { relativeTime, shortModelLabel, shortPath } from '../../../shared/format';
import { SpendLabel } from '../spend/SpendLabel';

/** What the session is: live, changed, which project, which worktree. */
const SessionTags: React.FC<{ session: AcpSessionSummary }> = ({ session }) => {
  const isGone = session.cwdExists === false;
  const isLive = isLiveSession(session) || !!session.cwdDirty;
  return (
    <Group gap="xs" wrap="wrap" align="center">
      <Text size="sm" fw={600} className="text-ink truncate max-w-[540px]" title={session.title}>
        {session.title}
      </Text>

      <Badge size="xs" color="gray" variant="dot" className="font-mono text-[10px] shrink-0">
        {session.sessionId.slice(0, 14)}
      </Badge>

      {isLive && !session.importedAsTaskId && (
        <Badge size="xs" color="teal" variant="light" className="font-mono shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block mr-1" />
          live
        </Badge>
      )}

      {session.changeSummary && (
        <Badge size="xs" color="gray" variant="light" className="font-mono shrink-0">
          +{session.changeSummary.additions} -{session.changeSummary.deletions}
        </Badge>
      )}

      {session.cwdDirty && (
        <Badge size="xs" color="yellow" variant="light" className="font-mono shrink-0">
          uncommitted
        </Badge>
      )}

      {session.projectName && (
        <Badge size="xs" color="gray" variant="light" className="font-mono shrink-0">
          {session.projectName}
        </Badge>
      )}

      {session.isWorktree && session.worktreeLabel && (
        <Badge
          size="xs"
          color={isGone ? 'gray' : 'accent'}
          variant="light"
          leftSection={<GitBranch className="w-3 h-3" />}
          className="font-mono shrink-0"
        >
          {isGone ? `gone · ${session.worktreeLabel}` : session.worktreeLabel}
        </Badge>
      )}
    </Group>
  );
};

/** Where it ran and what it cost: folder, model, agent, spend, size, age. */
const SessionMeta: React.FC<{ session: AcpSessionSummary }> = ({ session }) => (
  <Group gap="md" wrap="wrap" align="center" className="text-ink-2 text-xs">
    <Group gap={4} wrap="nowrap" className="min-w-0 max-w-[280px]">
      <Folder className="w-3.5 h-3.5 text-ink-3 shrink-0" />
      <Tooltip label={session.cwd} withArrow>
        <Text size="xs" c="dimmed" className="font-mono text-[11px] truncate">
          {shortPath(session.cwd)}
        </Text>
      </Tooltip>
    </Group>

    {session.model && (
      <Group gap={4} wrap="nowrap">
        <Cpu className="w-3 h-3 text-ink-3" />
        <Text size="xs" c="dimmed" className="font-mono text-[11px]">
          {shortModelLabel(session.model)}
        </Text>
      </Group>
    )}

    {session.agent && (
      <Group gap={4} wrap="nowrap">
        <Bot className="w-3 h-3 text-ink-3" />
        <Text size="xs" c="dimmed" className="font-mono text-[11px]">
          {session.agent}
        </Text>
      </Group>
    )}

    {!!session.subagentCount && session.subagentCount > 0 && (
      <Group gap={4} wrap="nowrap">
        <Users className="w-3 h-3 text-accent" />
        <Text size="xs" className="font-mono text-[11px] text-acc-fg">
          {session.subagentCount} subagent{session.subagentCount === 1 ? '' : 's'}
        </Text>
      </Group>
    )}

    <SpendLabel
      cost={session.cost}
      contextTokens={session.contextTokens}
      contextLimit={session.contextLimit}
      subagentCount={session.subagentCount}
    />

    {!!session.tokenCount && session.tokenCount > 0 && (
      <Text size="xs" c="dimmed" className="font-mono text-[11px]">
        {formatTokenCount(session.tokenCount)}
      </Text>
    )}

    <Tooltip label={`Updated ${new Date(session.updatedAt).toLocaleString()}`} withArrow>
      <Text size="xs" c="dimmed" className="font-mono text-[11px] shrink-0">
        · {relativeTime(session.updatedAt)}
      </Text>
    </Tooltip>
  </Group>
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

  return (
    <Paper
      p="sm"
      radius="md"
      className={`bg-surface border transition-all duration-150 ${
        isSelected
          ? 'border-accent/70 bg-acc-bg'
          : alreadyImported
            ? 'border-line/60 opacity-65'
            : 'border-line/80 hover:border-line-strong hover:bg-surface-2'
      }`}
    >
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
        <Checkbox
          size="xs"
          className="mt-1 shrink-0"
          checked={isSelected}
          onChange={onToggle}
          disabled={alreadyImported || bulkActive}
        />

        <Stack gap={6} className="min-w-0 flex-1">
          <SessionTags session={session} />
          <SessionMeta session={session} />
        </Stack>

        <div className="shrink-0 pt-0.5">
          {alreadyImported ? (
            <Badge size="sm" color="gray" variant="filled" className="font-mono font-bold">
              {session.importedAsTaskId}
            </Badge>
          ) : (
            <Button
              size="xs"
              variant="light"
              color="accent"
              loading={isBusy}
              disabled={bulkActive || isBusy}
              onClick={onImport}
              leftSection={!isBusy ? <Download className="w-3.5 h-3.5" /> : undefined}
              className="font-medium"
            >
              Import
            </Button>
          )}
        </div>
      </Group>
    </Paper>
  );
};
