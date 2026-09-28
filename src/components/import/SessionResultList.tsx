import React from 'react';
import { Badge, Group, Loader, Paper, ScrollArea, Stack, Text } from '@mantine/core';
import { AlertCircle, Calendar, History } from 'lucide-react';
import { AcpSessionSummary } from '../../../shared/sessions/types';
import { groupSessionsByWeek } from '../../../shared/sessions/list';
import { SessionCard } from './SessionCard';

interface SessionResultListProps {
  sessions: AcpSessionSummary[];
  isLoading: boolean;
  error: string | null;
  /** What was searched for, to say what found nothing. */
  query: string;
  /** Sorted by recency, so the list is worth breaking into weeks. */
  grouped: boolean;
  selected: Set<string>;
  importingId: string | null;
  bulkActive: boolean;
  onToggle: (sessionId: string) => void;
  onImport: (session: AcpSessionSummary) => void;
}

/** The scrolling list of sessions, or what is standing in for it. */
export const SessionResultList: React.FC<SessionResultListProps> = ({
  sessions,
  isLoading,
  error,
  query,
  grouped,
  selected,
  importingId,
  bulkActive,
  onToggle,
  onImport
}) => {
  const card = (session: AcpSessionSummary) => (
    <SessionCard
      key={session.sessionId}
      session={session}
      isSelected={selected.has(session.sessionId)}
      isBusy={importingId === session.sessionId}
      bulkActive={bulkActive}
      onToggle={() => onToggle(session.sessionId)}
      onImport={() => onImport(session)}
    />
  );

  return (
    <ScrollArea h={520} type="auto" className="bg-surface-3 rounded-xl border border-line/80 p-3">
      {isLoading && (
        <Group justify="center" py="xl" gap="sm">
          <Loader size="sm" color="accent" />
          <Text size="sm" c="dimmed" className="font-mono">
            Scanning OpenCode sessions…
          </Text>
        </Group>
      )}

      {error && !isLoading && (
        <Paper p="md" className="border border-rose-800/60 bg-rose-950/40 rounded-lg">
          <Group gap="sm">
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
            <Stack gap={2}>
              <Text size="sm" fw={600} className="text-rose-200">
                Failed to retrieve sessions
              </Text>
              <Text size="xs" className="text-rose-300/80 font-mono">
                {error}
              </Text>
            </Stack>
          </Group>
        </Paper>
      )}

      {!isLoading && !error && sessions.length === 0 && (
        <Stack align="center" justify="center" py={60} gap="xs">
          <Paper p="md" radius="xl" className="bg-surface-2 border border-line">
            <History className="w-8 h-8 text-ink-3" />
          </Paper>
          <Text size="sm" fw={600} className="text-slate-300">
            No sessions found
          </Text>
          <Text size="xs" c="dimmed" className="max-w-[360px] text-center font-mono">
            {query
              ? `No sessions matching "${query}" in this view.`
              : 'Try selecting a different filter tab, choosing another project folder, or enabling "Include Empty".'}
          </Text>
        </Stack>
      )}

      {!isLoading && !error && sessions.length > 0 && (
        <Stack gap="xs">
          {grouped
            ? groupSessionsByWeek(sessions).map((group) => (
              <Stack key={group.key} gap={6}>
                <Group gap="xs" align="center" className="px-2 pt-2">
                  <Calendar className="w-3.5 h-3.5 text-ink-3" />
                  <Text size="xs" className="font-mono text-[11px] uppercase tracking-wider text-ink-2 font-semibold">
                    {group.label}
                  </Text>
                  <Badge size="xs" color="gray" variant="light" className="font-mono">
                    {group.sessions.length}
                  </Badge>
                </Group>
                {group.sessions.map(card)}
              </Stack>
            ))
            : sessions.map(card)}
        </Stack>
      )}
    </ScrollArea>
  );
};
