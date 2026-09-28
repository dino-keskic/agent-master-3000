import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { errorMessage } from '../../app/notify';
import { AcpSessionSummary } from '../../../shared/sessions/types';
import { ProjectFolder } from '../../../shared/types';
import {
  filterSessions,
  SessionFilterTab,
  SessionSortOption,
  SessionTabCounts,
  sessionTabCounts,
  sortSessions
} from '../../../shared/sessions/import';
import { ALL_PROJECTS } from './SessionSearchBar';

export interface SessionList {
  /** The sessions the current tab and sort order put on screen. */
  visible: AcpSessionSummary[];
  counts: SessionTabCounts;
  /** How many sessions OpenCode has in total, before any tab narrows it. */
  total: number;
  untitledCount: number;
  isLoading: boolean;
  error: string | null;
  query: string;
  setQuery: (value: string) => void;
  tab: SessionFilterTab;
  setTab: (value: SessionFilterTab) => void;
  projectId: string;
  setProjectId: (value: string) => void;
  sortBy: SessionSortOption;
  setSortBy: (value: SessionSortOption) => void;
  showUntitled: boolean;
  setShowUntitled: (value: boolean) => void;
  showRemoved: boolean;
  setShowRemoved: (value: boolean) => void;
  /** Ask the server again — the sessions may have moved on since. */
  refresh: () => void;
}

/**
 * The session list behind the import modal.
 *
 * The search and the two "include" switches are questions for the server —
 * it is the one reading OpenCode's database. The tab and the sort order are
 * not: they only rearrange what has already arrived, so they never refetch.
 */
export function useSessionList(
  isOpen: boolean,
  projects: ProjectFolder[],
  initialFilter: SessionFilterTab,
  initialProjectId?: string
): SessionList {
  const [sessions, setSessions] = useState<AcpSessionSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [untitledCount, setUntitledCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [tab, setTab] = useState<SessionFilterTab>(initialFilter);
  const [projectId, setProjectId] = useState<string>(ALL_PROJECTS);
  const [sortBy, setSortBy] = useState<SessionSortOption>('recent');
  const [showUntitled, setShowUntitled] = useState(false);
  const [showRemoved, setShowRemoved] = useState(false);

  // Typing a query should not cost one OpenCode read per keystroke.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(handle);
  }, [query]);

  // Closing the modal resets the search, so it opens on the whole list again.
  // The project stays where it was left, unless the opener named one.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (!isOpen) {
      setQuery('');
      setDebouncedQuery('');
      setTab(initialFilter);
    } else if (initialProjectId) {
      setProjectId(initialProjectId);
    }
  }

  const cwd = projectId !== ALL_PROJECTS
    ? projects.find((p) => p.id === projectId)?.path
    : undefined;

  // Bumped to ask again with the same query; the fetch lives in the effect so
  // that a slow answer to an old query cannot land on top of a newer one.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    api.listSessions({ query: debouncedQuery, includeUntitled: showUntitled, includeRemoved: showRemoved, cwd })
      .then((body) => {
        if (cancelled) return;
        setSessions(body.sessions);
        setTotal(body.total);
        setUntitledCount(body.untitledCount);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e, 'Could not list OpenCode sessions'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, debouncedQuery, showUntitled, showRemoved, cwd, reloadToken]);

  const visible = useMemo(
    () => sortSessions(filterSessions(sessions, tab), sortBy),
    [sessions, tab, sortBy]
  );
  const counts = useMemo(() => sessionTabCounts(sessions), [sessions]);

  return {
    visible,
    counts,
    total,
    untitledCount,
    isLoading,
    error,
    query,
    setQuery,
    tab,
    setTab,
    projectId,
    setProjectId,
    sortBy,
    setSortBy,
    showUntitled,
    setShowUntitled,
    showRemoved,
    setShowRemoved,
    refresh: () => setReloadToken((n) => n + 1)
  };
}
