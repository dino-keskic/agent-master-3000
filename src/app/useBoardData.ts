import { Dispatch, SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import { OpenCodeAgent, OpenCodeModel } from '../../shared/sessions/types';
import { SpendSummary } from '../../shared/spend/types';
import { BoardTask, GlobalSettings, ProjectFolder, TaskLogItem } from '../../shared/types';
import { cloneDefaultColumns } from '../../shared/board/columns';
import { DEFAULT_PERMISSION_MODE } from '../../shared/agent/permissions';
import { api } from '../api';
import { errorMessage, reportError } from './notify';
import { rememberModelOptions, setBoardModel } from './modelOptions';
import { useBoardSocket } from './useBoardSocket';
import { useSpend } from './useSpend';
import { useTaskList } from './useTaskList';

/**
 * Everything the board knows, and the one way it learns it.
 *
 * The tasks live in `useTaskList` and the spend figure in `useSpend`; what is
 * here is the settings and catalogs that come with them, the one load that
 * fills all three, and the socket that keeps them current.
 */

export interface BoardData {
  tasks: BoardTask[];
  projects: ProjectFolder[];
  settings: GlobalSettings;
  models: OpenCodeModel[];
  agents: OpenCodeAgent[];
  isConnected: boolean;
  /** True once the first board load has landed; everything above it is real. */
  hasLoaded: boolean;
  /** Why the last board load failed, or null. Set even after a successful one. */
  loadError: string | null;
  spend: SpendSummary | null;
  isSpendLoading: boolean;
  setSettings: Dispatch<SetStateAction<GlobalSettings>>;
  setProjects: Dispatch<SetStateAction<ProjectFolder[]>>;
  setModels: Dispatch<SetStateAction<OpenCodeModel[]>>;
  setAgents: Dispatch<SetStateAction<OpenCodeAgent[]>>;
  /** Fold a task the server just sent into the board. */
  applySnapshot: (task: BoardTask, log?: TaskLogItem) => void;
  /** Drop tasks the server no longer has. */
  removeTasks: (taskIds: string[]) => void;
  refresh: () => Promise<void>;
  refreshSpend: (announce?: boolean) => Promise<void>;
}

const INITIAL_SETTINGS: GlobalSettings = {
  defaultModel: 'github-copilot/claude-sonnet-4.6',
  defaultAgent: '',
  defaultThinkingLevel: 'default',
  defaultPermissionMode: DEFAULT_PERMISSION_MODE,
  defaultCwd: '',
  projects: [],
  columns: cloneDefaultColumns()
};

export function useBoardData(): BoardData {
  const [projects, setProjects] = useState<ProjectFolder[]>([]);
  const [settings, setSettings] = useState<GlobalSettings>(INITIAL_SETTINGS);
  const [models, setModels] = useState<OpenCodeModel[]>([]);
  const [agents, setAgents] = useState<OpenCodeAgent[]>([]);
  // The load is a fact about the board, not only a toast: until it has landed
  // the settings and tasks below are placeholders, and the screen has to say so.
  const [hasLoaded, setHasLoaded] = useState(false);
  // Read inside `refresh` without making it a dependency: a `refresh` that
  // changed identity on the first success would re-run every effect holding it.
  const hasLoadedRef = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const { tasks, applySnapshot, removeTasks, replaceAll } = useTaskList();
  const { spend, isSpendLoading, refreshSpend, seedSpend } = useSpend();

  const refresh = useCallback(async () => {
    // A retry should read as trying again, not as the old failure still standing.
    setLoadError(null);
    try {
      const data = await api.getBoard();
      replaceAll(data.tasks);
      setSettings(data.settings);
      setProjects(data.settings.projects);
      setModels(data.models);
      setAgents(data.agents);
      // The lists in a board response are the default model's; file them under it
      // so a dropdown sitting next to a different model does not borrow them.
      rememberModelOptions(data.settings.defaultModel, data);
      setBoardModel(data.settings.defaultModel);
      if (data.spend) seedSpend(data.spend);
      setLoadError(null);
      hasLoadedRef.current = true;
      setHasLoaded(true);
    } catch (e) {
      setLoadError(errorMessage(e, 'Could not reach the board server'));
      // Before the first load the loading screen already states the reason and
      // offers the retry, so a toast would only say it twice. After that the
      // board is on screen and a failed refresh has nowhere else to be seen.
      if (hasLoadedRef.current) reportError('Could not load the board', e);
    }
  }, [replaceAll, seedSpend]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Coming back to the tab is the moment the board is most likely to be stale.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void refresh();
      void refreshSpend();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh, refreshSpend]);

  const isConnected = useBoardSocket({
    onSnapshot: applySnapshot,
    onProjects: setProjects,
    onTaskDeleted: (taskId) => removeTasks([taskId])
  });

  // Whatever changed while the socket was down — a turn that finished during a
  // server restart, a client the server cut off for falling behind — was never
  // pushed, so a reconnect reloads the board rather than trusting it.
  const everConnected = useRef(false);
  useEffect(() => {
    if (!isConnected) return;
    if (everConnected.current) void refresh();
    everConnected.current = true;
  }, [isConnected, refresh]);

  return {
    tasks,
    projects,
    settings,
    models,
    agents,
    isConnected,
    hasLoaded,
    loadError,
    spend,
    isSpendLoading,
    setSettings,
    setProjects,
    setModels,
    setAgents,
    applySnapshot,
    removeTasks,
    refresh,
    refreshSpend
  };
}
