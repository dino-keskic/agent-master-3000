import { useCallback, useEffect, useState } from 'react';
import { ProjectFolder } from '../../../shared/types';
import {
  ColumnPromptMap,
  pruneColumnPrompts,
  sameColumnPrompts,
  setColumnPrompt
} from '../../../shared/board/projectColumnPrompts';
import { api } from '../../api';
import { reportError } from '../../app/notify';

/**
 * The per-project column instructions being edited, and the projects to hang
 * them on.
 *
 * The editor loads the projects itself rather than taking them as a prop: the
 * modal is the only screen that writes these, and a board-wide prop would put
 * a list nothing else on the board needs through every render of the header.
 *
 * Like `useColumnDraft`, nothing here reaches the board until `save()`, so
 * cancelling the modal drops the edits.
 */

export interface ProjectPromptsDraft {
  projects: ProjectFolder[];
  /** What this project says about this column, as typed (not trimmed). */
  promptFor: (projectId: string, columnId: string) => string;
  setPrompt: (projectId: string, columnId: string, text: string) => void;
  /** Save the projects whose instructions changed; ids of the columns that survive. */
  save: (liveColumnIds: string[]) => Promise<void>;
}

type PromptsByProject = Record<string, ColumnPromptMap>;

function mapsOf(projects: ProjectFolder[]): PromptsByProject {
  return Object.fromEntries(projects.map((project) => [project.id, { ...(project.columnPrompts || {}) }]));
}

export function useProjectPrompts(opened: boolean): ProjectPromptsDraft {
  const [projects, setProjects] = useState<ProjectFolder[]>([]);
  // The server's copy, kept to answer "did the user change anything" at save.
  const [saved, setSaved] = useState<PromptsByProject>({});
  const [draft, setDraft] = useState<PromptsByProject>({});

  // Data arriving, not prop-sync: the modal is opened rarely and the folders
  // may have changed on another tab since the board loaded.
  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    void api
      .listProjects()
      .then((loaded) => {
        if (cancelled) return;
        setProjects(loaded);
        setSaved(mapsOf(loaded));
        setDraft(mapsOf(loaded));
      })
      .catch((e) => {
        if (!cancelled) reportError('Could not load projects', e);
      });
    return () => {
      cancelled = true;
    };
  }, [opened]);

  const promptFor = useCallback(
    (projectId: string, columnId: string) => draft[projectId]?.[columnId] || '',
    [draft]
  );

  const setPrompt = useCallback((projectId: string, columnId: string, text: string) => {
    setDraft((prev) => ({ ...prev, [projectId]: setColumnPrompt(prev[projectId], columnId, text) }));
  }, []);

  const save = useCallback(
    async (liveColumnIds: string[]) => {
      // A column the user just deleted takes its instructions with it, so a
      // later column that slugs to the same id cannot inherit them.
      const pruned: PromptsByProject = {};
      for (const project of projects) {
        pruned[project.id] = pruneColumnPrompts(draft[project.id], liveColumnIds);
      }

      const changed = Object.fromEntries(
        Object.entries(pruned).filter(([projectId, map]) => !sameColumnPrompts(map, saved[projectId]))
      );
      if (Object.keys(changed).length === 0) return;

      try {
        await api.saveProjectColumnPrompts(changed);
      } catch (e) {
        reportError('Could not save project instructions', e);
      }
    },
    [projects, draft, saved]
  );

  return { projects, promptFor, setPrompt, save };
}
