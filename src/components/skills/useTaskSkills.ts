import { useCallback, useEffect, useRef, useState } from 'react';
import { SaveSkillInput, SkillInventory, SkillItem } from '../../../shared/skills/skills';
import { api, ApiError } from '../../api';
import { notifySuccess, reportError } from '../../app/notify';

/**
 * Loads skills visible to the task's folder and handles creating, editing,
 * deleting, toggling availability, and managing bundled files inside a skill directory.
 */

export interface TaskSkillsState {
  inventory: SkillInventory | null;
  loading: boolean;
  saving: boolean;
  restarting: boolean;
  needsForce: boolean;
  selectedKey: string | null;
  creating: boolean;
  setSelectedKey: (key: string | null) => void;
  startCreate: () => void;
  reload: () => void;
  saveSkill: (input: SaveSkillInput) => Promise<SkillItem | null>;
  deleteSkill: (dirPath: string) => Promise<void>;
  toggleSkill: (name: string, enabled: boolean) => Promise<void>;
  restart: () => void;
  readAuxFile: (dirPath: string, relativePath: string) => Promise<string | null>;
  saveAuxFile: (dirPath: string, relativePath: string, content: string) => Promise<boolean>;
  deleteAuxFile: (dirPath: string, relativePath: string) => Promise<boolean>;
}

export function useTaskSkills(
  taskId: string | undefined,
  sessionId: string | undefined,
  cwd?: string
): TaskSkillsState {
  const [inventory, setInventory] = useState<SkillInventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [needsForce, setNeedsForce] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const res = await api.getTaskSkills(taskId, sessionId, cwd);
      if (loadSeq.current !== seq) return;
      setInventory(res);
      setSelectedKey((prev) => {
        if (prev && res.skills.some((s) => s.key === prev)) return prev;
        const first = res.skills.find((s) => !s.shadowedBy) ?? res.skills[0];
        return first?.key ?? null;
      });
    } catch (e) {
      if (loadSeq.current !== seq) return;
      reportError('Could not load skills', e);
      setInventory(null);
    } finally {
      if (loadSeq.current === seq) setLoading(false);
    }
  }, [taskId, sessionId, cwd]);

  useEffect(() => {
    void load();
    return () => {
      loadSeq.current += 1;
    };
  }, [load]);

  const startCreate = useCallback(() => {
    setCreating(true);
  }, []);

  const selectExisting = useCallback((key: string | null) => {
    setCreating(false);
    setSelectedKey(key);
  }, []);

  const saveSkill = useCallback(
    async (input: SaveSkillInput): Promise<SkillItem | null> => {
      setSaving(true);
      try {
        const res = await api.saveTaskSkill(taskId, input, sessionId, cwd);
        setInventory(res.inventory);
        setCreating(false);
        setSelectedKey(res.skill.key);
        notifySuccess(input.dirPath ? 'Skill saved' : 'Skill created', `/${res.skill.name}`);
        return res.skill;
      } catch (e) {
        reportError('Could not save skill', e);
        return null;
      } finally {
        setSaving(false);
      }
    },
    [taskId, sessionId, cwd]
  );

  const deleteSkill = useCallback(
    async (dirPath: string) => {
      setSaving(true);
      try {
        const res = await api.deleteTaskSkill(taskId, dirPath, sessionId, cwd);
        setInventory(res.inventory);
        const next = res.inventory.skills.find((s) => !s.shadowedBy) ?? res.inventory.skills[0];
        setSelectedKey(next?.key ?? null);
        notifySuccess('Skill deleted', 'Removed the skill directory');
      } catch (e) {
        reportError('Could not delete skill', e);
      } finally {
        setSaving(false);
      }
    },
    [taskId, sessionId, cwd]
  );

  const readAuxFile = useCallback(
    async (dirPath: string, relativePath: string): Promise<string | null> => {
      try {
        const res = await api.readSkillFile(taskId, dirPath, relativePath, sessionId, cwd);
        return res.content;
      } catch (e) {
        reportError('Could not read skill file', e);
        return null;
      }
    },
    [taskId, sessionId, cwd]
  );

  const saveAuxFile = useCallback(
    async (dirPath: string, relativePath: string, content: string): Promise<boolean> => {
      setSaving(true);
      try {
        const res = await api.saveSkillFile(taskId, { dirPath, relativePath, content }, sessionId, cwd);
        setInventory(res.inventory);
        notifySuccess('File saved', relativePath);
        return true;
      } catch (e) {
        reportError('Could not save skill file', e);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [taskId, sessionId, cwd]
  );

  const deleteAuxFile = useCallback(
    async (dirPath: string, relativePath: string): Promise<boolean> => {
      setSaving(true);
      try {
        const res = await api.deleteSkillFile(taskId, { dirPath, relativePath }, sessionId, cwd);
        setInventory(res.inventory);
        notifySuccess('File deleted', relativePath);
        return true;
      } catch (e) {
        reportError('Could not delete skill file', e);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [taskId, sessionId, cwd]
  );

  const toggleSkill = useCallback(async (name: string, enabled: boolean) => {
    setSaving(true);
    try {
      const res = await api.setSkillPolicy(name, enabled ? null : false);
      setInventory((prev) =>
        prev
          ? {
              ...prev,
              skillPolicy: res.skillPolicy,
              pendingRestart: res.pendingRestart,
              skills: prev.skills.map((s) => (s.name === name ? { ...s, disabled: !enabled } : s))
            }
          : prev
      );
      notifySuccess(
        enabled ? 'Skill enabled' : 'Skill disabled',
        res.pendingRestart
          ? `/${name} — restart OpenCode when ready to apply to running turns`
          : `/${name} is now ${enabled ? 'available' : 'hidden'}`
      );
    } catch (e) {
      reportError('Could not update skill status', e);
    } finally {
      setSaving(false);
    }
  }, []);

  const restart = useCallback(async (force: boolean) => {
    setRestarting(true);
    try {
      await api.restartAgent(force);
      notifySuccess('Agent restarting', 'OpenCode will reload the updated skills');
      setNeedsForce(false);
      setInventory((prev) => (prev ? { ...prev, pendingRestart: false } : prev));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setNeedsForce(true);
        reportError('Sessions are still running', `${e.message}. Press again to restart anyway and drop them.`);
      } else {
        reportError('Could not restart OpenCode', e);
      }
    } finally {
      setRestarting(false);
    }
  }, []);

  return {
    inventory,
    loading,
    saving,
    restarting,
    needsForce,
    selectedKey,
    creating,
    setSelectedKey: selectExisting,
    startCreate,
    reload: () => void load(),
    saveSkill,
    deleteSkill,
    toggleSkill,
    restart: () => void restart(needsForce),
    readAuxFile,
    saveAuxFile,
    deleteAuxFile
  };
}
