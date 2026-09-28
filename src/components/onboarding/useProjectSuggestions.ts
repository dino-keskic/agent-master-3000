import { useEffect, useState } from 'react';
import { api } from '../../api';
import { ProjectSuggestion } from '../../../shared/setup/onboarding';

/**
 * The folders the welcome screen offers, read once when it appears. A failed
 * read is an empty list: the folder picker is still there, and a new user has
 * no use for an error about OpenCode's database.
 */
export function useProjectSuggestions(): { suggestions: ProjectSuggestion[]; isLoading: boolean } {
  const [suggestions, setSuggestions] = useState<ProjectSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.projectSuggestions()
      .then((found) => {
        if (!cancelled) setSuggestions(found);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { suggestions, isLoading };
}

/** How many OpenCode sessions a folder has, or undefined while it is being asked. */
export function useFolderSessionCount(folder: string): number | undefined {
  const [counted, setCounted] = useState<{ folder: string; total: number }>();

  useEffect(() => {
    let cancelled = false;
    // One row is enough: the answer is `total`, which counts them all.
    api.listSessions({ cwd: folder, limit: 1 })
      .then((body) => {
        if (!cancelled) setCounted({ folder, total: body.total });
      })
      .catch(() => {
        if (!cancelled) setCounted({ folder, total: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [folder]);

  return counted?.folder === folder ? counted.total : undefined;
}
