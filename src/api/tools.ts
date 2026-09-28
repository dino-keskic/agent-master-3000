/** The agent's tools: what a session can call, the board's on/off policy, and the restart that applies it. */

import { SessionToolInventory } from '../../shared/agent/tools';
import { request } from './http';

export const toolsApi = {
  /**
   * What the agent can call in this session. The server starts an OpenCode
   * instance to answer, so this is only fetched when the Tools tab is opened.
   */
  getSessionTools: (taskId: string, sessionId?: string, refresh = false) => {
    const params = new URLSearchParams();
    if (sessionId) params.set('session', sessionId);
    if (refresh) params.set('refresh', '1');
    const query = params.toString();
    return request<SessionToolInventory>(`/api/tasks/${taskId}/tools${query ? `?${query}` : ''}`);
  },

  /**
   * Turn a tool off or on for every session the board runs. `enabled: null`
   * removes the board's override and defers to the user's OpenCode config.
   */
  setToolPolicy: (name: string, enabled: boolean | null) =>
    request<{ policy: Record<string, boolean>; pendingRestart: boolean }>('/api/tools/policy', {
      method: 'POST',
      body: JSON.stringify({ name, enabled })
    }),

  /** Restart the agent process so it runs with the current tool policy. */
  restartAgent: (force = false) =>
    request<{ restarted: boolean }>('/api/agent/restart', {
      method: 'POST',
      body: JSON.stringify({ force })
    })
};
