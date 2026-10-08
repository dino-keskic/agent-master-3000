import { useCallback, useEffect, useRef, useState } from 'react';
import { SessionToolInventory, applyToolPolicyRule } from '../../../shared/agent/tools';
import { api, ApiError } from '../../api';
import { notifySuccess, reportError } from '../../app/notify';

/**
 * The panel's data: what the session can call, and the two ways to change it.
 *
 * Reading the inventory starts an OpenCode instance, so it is done as rarely as
 * possible — once on open, once when a turn ends, and whenever the user asks.
 * A saved override is folded into the list in place rather than re-read.
 */

export interface SessionTools {
  inventory: SessionToolInventory | null;
  loading: boolean;
  /** A save or a restart is in flight; every switch is inert until it lands. */
  busy: boolean;
  restarting: boolean;
  /** Set after a refused restart: the next press is the one that insists. */
  needsForce: boolean;
  reload: (refresh?: boolean) => void;
  /** Save one rule. `null` drops the board's override for it. */
  save: (rule: string, enabled: boolean | null) => void;
  restart: () => void;
}

export function useSessionTools(
  taskId: string,
  sessionId: string | undefined,
  running: boolean
): SessionTools {
  const [inventory, setInventory] = useState<SessionToolInventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [needsForce, setNeedsForce] = useState(false);

  const load = useCallback(
    async (showSpinner: boolean, refresh = false) => {
      if (showSpinner) setLoading(true);
      try {
        setInventory(await api.getSessionTools(taskId, sessionId, refresh));
      } catch (e) {
        reportError('Could not read the session tools', e);
        setInventory(null);
      } finally {
        setLoading(false);
      }
    },
    [taskId, sessionId]
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  // Usage counts move while a turn runs; the catalog behind them does not.
  // One quiet refresh when the turn ends is enough.
  const wasRunning = useRef(running);
  useEffect(() => {
    if (running) {
      wasRunning.current = true;
      return;
    }
    if (!wasRunning.current) return;
    wasRunning.current = false;
    void load(false);
  }, [running, load]);

  const save = useCallback(async (rule: string, enabled: boolean | null) => {
    setSaving(true);
    try {
      const result = await api.setToolPolicy(rule, enabled);
      setInventory((prev) => (prev ? applyToolPolicyRule(prev, rule, enabled, result.policy, result.pendingRestart) : prev));
    } catch (e) {
      reportError('Could not change that tool', e);
    } finally {
      setSaving(false);
    }
  }, []);

  const restart = useCallback(async (force: boolean) => {
    setRestarting(true);
    try {
      await api.restartAgent(force);
      notifySuccess('Agent restarting', 'Follow-ups and new sessions run with the current tool list');
      setNeedsForce(false);
      setInventory((prev) => (prev ? { ...prev, pendingRestart: false } : prev));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setNeedsForce(true);
        reportError('Sessions are still running', `${e.message}. Press again to restart anyway and drop them.`);
      } else {
        reportError('Could not restart the agent', e);
      }
    } finally {
      setRestarting(false);
    }
  }, []);

  return {
    inventory,
    loading,
    busy: saving || restarting,
    restarting,
    needsForce,
    reload: (refresh = false) => void load(true, refresh),
    save: (rule, enabled) => void save(rule, enabled),
    restart: () => void restart(needsForce)
  };
}
