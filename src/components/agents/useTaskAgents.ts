import { useCallback, useEffect, useRef, useState } from 'react';
import { AgentInventory, CustomAgent, SaveAgentInput } from '../../../shared/agent/customAgents';
import { SessionToolInventory } from '../../../shared/agent/tools';
import { api, ApiError } from '../../api';
import { notifySuccess, reportError } from '../../app/notify';

/**
 * Loads custom + built-in agents for the task's folder alongside the session's
 * tool catalog, and handles creating, editing, deleting, and per-agent tool toggles.
 */

export interface TaskAgentsState {
  inventory: AgentInventory | null;
  toolInventory: SessionToolInventory | null;
  loading: boolean;
  toolsLoading: boolean;
  saving: boolean;
  restarting: boolean;
  needsForce: boolean;
  selectedKey: string | null;
  creating: boolean;
  setSelectedKey: (key: string | null) => void;
  startCreate: (template?: CustomAgent) => void;
  createTemplate: CustomAgent | null;
  reload: (refreshTools?: boolean) => void;
  saveAgent: (input: SaveAgentInput) => Promise<CustomAgent | null>;
  toggleTool: (agent: CustomAgent, rule: string, enabled: boolean | null) => Promise<void>;
  deleteAgent: (filePath: string) => Promise<void>;
  restart: () => void;
}

function pickInitialKey(agents: CustomAgent[], activeAgent?: string): string | null {
  if (agents.length === 0) return null;
  if (activeAgent) {
    const lower = activeAgent.toLowerCase();
    const match = agents.find((a) => !a.shadowedBy && a.id.toLowerCase() === lower);
    if (match) return match.key;
  }
  const firstCustom = agents.find((a) => a.sourceKind === 'markdown' && !a.shadowedBy);
  return firstCustom?.key ?? agents[0]!.key;
}

export function useTaskAgents(
  taskId: string | undefined,
  sessionId: string | undefined,
  activeAgent: string | undefined,
  cwd?: string
): TaskAgentsState {
  const [inventory, setInventory] = useState<AgentInventory | null>(null);
  const [toolInventory, setToolInventory] = useState<SessionToolInventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [toolsLoading, setToolsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [needsForce, setNeedsForce] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createTemplate, setCreateTemplate] = useState<CustomAgent | null>(null);
  const loadSeq = useRef(0);

  const load = useCallback(
    async (refreshTools = false) => {
      const seq = ++loadSeq.current;
      setLoading(true);
      setToolsLoading(true);
      const agentsPromise = api
        .getTaskAgents(taskId, sessionId, cwd)
        .then((res) => {
          if (loadSeq.current !== seq) return;
          setInventory(res);
          setSelectedKey((prev) => {
            if (prev && res.agents.some((a) => a.key === prev)) return prev;
            return pickInitialKey(res.agents, activeAgent);
          });
        })
        .catch((e) => {
          if (loadSeq.current !== seq) return;
          reportError('Could not load agents', e);
          setInventory(null);
        })
        .finally(() => {
          if (loadSeq.current === seq) setLoading(false);
        });

      const toolsPromise = api
        .getSessionTools(taskId, sessionId, refreshTools, cwd)
        .then((res) => {
          if (loadSeq.current === seq) setToolInventory(res);
        })
        .catch(() => {
          if (loadSeq.current === seq) setToolInventory(null);
        })
        .finally(() => {
          if (loadSeq.current === seq) setToolsLoading(false);
        });

      await Promise.all([agentsPromise, toolsPromise]);
    },
    [taskId, sessionId, activeAgent, cwd]
  );

  useEffect(() => {
    void load(false);
    return () => {
      loadSeq.current += 1;
    };
  }, [load]);

  const startCreate = useCallback((template?: CustomAgent) => {
    setCreateTemplate(template ?? null);
    setCreating(true);
  }, []);

  const selectExisting = useCallback((key: string | null) => {
    setCreating(false);
    setCreateTemplate(null);
    setSelectedKey(key);
  }, []);

  const saveAgent = useCallback(
    async (input: SaveAgentInput): Promise<CustomAgent | null> => {
      setSaving(true);
      try {
        const res = await api.saveTaskAgent(taskId, input, sessionId, cwd);
        setInventory(res.inventory);
        setCreating(false);
        setCreateTemplate(null);
        if (res.agent) setSelectedKey(res.agent.key);
        notifySuccess(
          input.filePath ? 'Agent saved' : 'Agent created',
          res.pendingRestart
            ? 'Saved to disk — restart OpenCode when ready to use it in running turns'
            : `${input.id} is ready to use`
        );
        return res.agent ?? null;
      } catch (e) {
        reportError('Could not save agent', e);
        return null;
      } finally {
        setSaving(false);
      }
    },
    [taskId, sessionId, cwd]
  );

  const toggleTool = useCallback(
    async (agent: CustomAgent, rule: string, enabled: boolean | null) => {
      setSaving(true);
      try {
        const res = await api.setAgentTool(
          taskId,
          {
            filePath: agent.sourceKind === 'markdown' ? agent.filePath : undefined,
            agentId: agent.id,
            rule,
            enabled
          },
          sessionId,
          cwd
        );
        setInventory(res.inventory);
        if (res.agent) setSelectedKey(res.agent.key);
      } catch (e) {
        reportError('Could not update agent tool', e);
      } finally {
        setSaving(false);
      }
    },
    [taskId, sessionId, cwd]
  );

  const deleteAgent = useCallback(
    async (filePath: string) => {
      setSaving(true);
      try {
        const res = await api.deleteTaskAgent(taskId, filePath, sessionId, cwd);
        setInventory(res.inventory);
        setSelectedKey(pickInitialKey(res.inventory.agents, activeAgent));
        notifySuccess('Agent deleted', 'Removed the custom agent file');
      } catch (e) {
        reportError('Could not delete agent', e);
      } finally {
        setSaving(false);
      }
    },
    [taskId, sessionId, activeAgent, cwd]
  );

  const restart = useCallback(
    async (force: boolean) => {
      setRestarting(true);
      try {
        await api.restartAgent(force);
        notifySuccess('Agent restarting', 'OpenCode will reload the updated custom agents');
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
    },
    []
  );

  return {
    inventory,
    toolInventory,
    loading,
    toolsLoading,
    saving,
    restarting,
    needsForce,
    selectedKey,
    creating,
    createTemplate,
    setSelectedKey: selectExisting,
    startCreate,
    reload: (refreshTools = false) => void load(refreshTools),
    saveAgent,
    toggleTool,
    deleteAgent,
    restart: () => void restart(needsForce)
  };
}
