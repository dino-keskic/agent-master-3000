import { useEffect, useSyncExternalStore } from 'react';
import { OpenCodeAgent } from '../../shared/sessions/types';
import { ThinkingLevelOption } from '../../shared/types';
import { api, ConfigOptionsResponse } from '../api';

/**
 * What each model offers, per model.
 *
 * Agents and thinking levels are a property of the model, not of the board:
 * one model has low/high/max, the next has none at all, and the names differ.
 * The board used to carry a single list — whatever the *default* model
 * reported — down a prop chain and show it against every model, so picking
 * gpt-6-astra offered levels belonging to kimi-k3. This store keeps one entry
 * per model instead, and every dropdown reads the entry for the model it is
 * actually sitting next to.
 *
 * A model nobody has asked about yet is fetched on first use and remembered
 * for the tab's lifetime; nothing is invented while that is in flight.
 */

export interface ModelOptions {
  agents: OpenCodeAgent[];
  effortLevels: ThinkingLevelOption[];
  /** False until OpenCode has answered for this model — an empty list is not an answer. */
  known: boolean;
}

const UNKNOWN: ModelOptions = { agents: [], effortLevels: [], known: false };

const byModel = new Map<string, ModelOptions>();
const pending = new Set<string>();
const listeners = new Set<() => void>();
/** The model the board itself was configured for — what a dropdown with no model of its own means. */
let boardModel = '';

function announce(): void {
  for (const listener of listeners) listener();
}

/**
 * Record a config response the board already paid for.
 *
 * Empty lists mean the probe could not answer — the agent is still starting,
 * or could not switch to that model yet. Caching that would pin "this model
 * has no thinking levels" for the rest of the session, so only an answer that
 * carries models counts as one.
 */
export function rememberModelOptions(model: string, config: ConfigOptionsResponse): void {
  if (!model || config.models.length === 0) return;
  byModel.set(model, { agents: config.agents, effortLevels: config.effortLevels, known: true });
  announce();
}

/** Which model the dropdowns mean when they have no model of their own. */
export function setBoardModel(model: string): void {
  if (model === boardModel) return;
  boardModel = model;
  announce();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Waits before asking again about a model OpenCode has not answered for. */
const RETRY_DELAYS_MS = [2000, 5000, 15000, 30000, 60000];

/**
 * Ask until OpenCode answers. One failed round-trip — the agent restarting,
 * a model the probe could not switch to yet — used to leave the dropdown on
 * "Default" for the life of the tab, because nothing ever asked again.
 */
async function load(model: string, attempt = 0): Promise<void> {
  if (pending.has(model) || byModel.has(model)) return;
  pending.add(model);
  try {
    rememberModelOptions(model, await api.getConfigOptions(model));
  } catch {
    // Silent: a dropdown that offers only "Default" already says we don't know,
    // and a toast per opened select would be worse than the missing levels.
  } finally {
    pending.delete(model);
  }
  if (byModel.has(model)) return;
  const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
  setTimeout(() => void load(model, attempt + 1), delay);
}

/**
 * The options for `model`, falling back to the board's own model when a
 * dropdown does not pin one (a column set to "keep current model").
 */
export function useModelOptions(model?: string): ModelOptions {
  const options = useSyncExternalStore(subscribe, () => byModel.get(model || boardModel) ?? UNKNOWN);
  const wanted = model || boardModel;

  useEffect(() => {
    if (wanted && !byModel.has(wanted)) void load(wanted);
  }, [wanted]);

  return options;
}
