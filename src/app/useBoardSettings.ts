import { Dispatch, SetStateAction, useCallback, useState } from 'react';
import { OpenCodeAgent, OpenCodeModel } from '../../shared/sessions/types';
import { GlobalSettings, ProjectFolder } from '../../shared/types';
import { api } from '../api';
import { notifySuccess, reportError } from './notify';
import { rememberModelOptions, setBoardModel } from './modelOptions';

/**
 * Board-wide settings and the projects they point at.
 *
 * These belong together because they are written together: adding a project
 * also makes it the one new tasks are created in, and choosing a model
 * changes which agents and effort levels there are to choose from.
 */

export interface BoardSettingsContext {
  settings: GlobalSettings;
  setSettings: Dispatch<SetStateAction<GlobalSettings>>;
  setProjects: Dispatch<SetStateAction<ProjectFolder[]>>;
  setModels: Dispatch<SetStateAction<OpenCodeModel[]>>;
  setAgents: Dispatch<SetStateAction<OpenCodeAgent[]>>;
}

export interface BoardSettingsActions {
  updateSettings: (patch: Partial<GlobalSettings>) => Promise<void>;
  /** The project added (or already there), or nothing when it could not be. */
  addProject: (name: string, folderPath: string) => Promise<ProjectFolder | undefined>;
  /** Open the OS folder dialog and add what comes back. */
  pickProjectFolder: () => Promise<ProjectFolder | undefined>;
  deleteProject: (projectId: string) => Promise<void>;
  isPickingFolder: boolean;
}

export function useBoardSettings(ctx: BoardSettingsContext): BoardSettingsActions {
  const [isPickingFolder, setIsPickingFolder] = useState(false);
  const { settings, setSettings, setProjects, setModels, setAgents } = ctx;

  // Applied locally first: the header controls are the settings, so waiting for
  // the round trip would leave the user's own choice lagging behind them.
  const updateSettings = useCallback(async (patch: Partial<GlobalSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));

    if (patch.defaultModel && patch.defaultModel !== settings.defaultModel) {
      try {
        const config = await api.getConfigOptions(patch.defaultModel);
        setModels(config.models);
        setAgents(config.agents);
        rememberModelOptions(patch.defaultModel, config);
        setBoardModel(patch.defaultModel);
      } catch (e) {
        reportError('Could not sync model options', e);
      }
    }

    try {
      await api.updateSettings(patch);
    } catch (e) {
      reportError('Could not save settings', e);
    }
  }, [settings.defaultModel, setSettings, setModels, setAgents]);

  const addProject = useCallback(async (name: string, folderPath: string) => {
    try {
      const project = await api.addProject(name, folderPath);
      setProjects((prev) => [...prev.filter((p) => p.id !== project.id), project]);
      void updateSettings({ selectedProjectId: project.id, defaultCwd: project.path });
      notifySuccess('Project added', `Active project: ${project.name}`);
      return project;
    } catch (e) {
      reportError('Could not add project', e);
      return undefined;
    }
  }, [setProjects, updateSettings]);

  return {
    isPickingFolder,
    updateSettings,
    addProject,

    // The dialog runs server-side: a browser cannot hand out an absolute path.
    async pickProjectFolder() {
      if (isPickingFolder) return undefined;
      setIsPickingFolder(true);
      try {
        const data = await api.pickFolder(settings.defaultCwd);
        if (data.cancelled) return undefined;
        return await addProject(data.name, data.path);
      } catch (e) {
        reportError('Folder picker failed', e);
        return undefined;
      } finally {
        setIsPickingFolder(false);
      }
    },

    async deleteProject(projectId) {
      try {
        await api.deleteProject(projectId);
        setProjects((prev) => prev.filter((p) => p.id !== projectId));
      } catch (e) {
        reportError('Could not delete project', e);
      }
    }
  };
}
