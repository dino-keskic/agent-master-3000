import React from 'react';
import { Loader, ScrollArea } from '@mantine/core';
import { AlertCircle, Calendar, History } from 'lucide-react';
import { AcpSessionSummary } from '../../../shared/sessions/types';
import { groupSessionsByWeek } from '../../../shared/sessions/list';
import { Banner, EmptyState } from '../ui';
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
    <ScrollArea h={500} type="auto" className="bg-surface-3 rounded-xl border border-line p-3">
      {isLoading && (
        <div className="flex items-center justify-center py-12 gap-2.5">
          <Loader size="sm" color="accent" />
          <span className="font-mono text-[12.5px] text-ink-3">
            Scanning OpenCode sessions…
          </span>
        </div>
      )}

      {error && !isLoading && (
        <Banner tone="err" icon={<AlertCircle className="w-4 h-4" />} title="Failed to retrieve sessions">
          <span className="font-mono">{error}</span>
        </Banner>
      )}

      {!isLoading && !error && sessions.length === 0 && (
        <EmptyState
          icon={<History className="w-5 h-5" />}
          title="No sessions found"
          description={
            query
              ? `No sessions matching "${query}" in this view.`
              : 'Try selecting a different filter tab, choosing another project folder, or enabling "Include empty".'
          }
        />
      )}

      {!isLoading && !error && sessions.length > 0 && (
        <div className="flex flex-col gap-3">
          {grouped
            ? groupSessionsByWeek(sessions).map((group) => (
                <div key={group.key} className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 px-1 pt-1">
                    <Calendar className="w-3.5 h-3.5 text-ink-3" />
                    <span className="font-mono text-[11px] uppercase tracking-wider text-ink-2 font-semibold">
                      {group.label}
                    </span>
                    <span className="bubble is-muted">{group.sessions.length}</span>
                  </div>
                  {group.sessions.map(card)}
                </div>
              ))
            : sessions.map(card)}
        </div>
      )}
    </ScrollArea>
  );
};
