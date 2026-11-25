/** Custom agents: listing, creating/editing markdown agents, and per-agent tool switches. */

import { AgentInventory, AgentMutationResult, SaveAgentInput } from '../../shared/agent/customAgents';
import { request } from './http';

function agentsUrl(
  taskId: string | undefined,
  suffix: string,
  sessionId?: string,
  cwd?: string
): string {
  const params = new URLSearchParams();
  if (taskId) {
    if (sessionId) params.set('session', sessionId);
  } else if (cwd) {
    params.set('cwd', cwd);
  }
  const query = params.toString();
  const base = taskId ? `/api/tasks/${taskId}/agents${suffix}` : `/api/workspace/agents${suffix}`;
  return `${base}${query ? `?${query}` : ''}`;
}

export const agentsApi = {
  getTaskAgents: (taskId: string | undefined, sessionId?: string, cwd?: string) =>
    request<AgentInventory>(agentsUrl(taskId, '', sessionId, cwd)),

  saveTaskAgent: (taskId: string | undefined, input: SaveAgentInput, sessionId?: string, cwd?: string) =>
    request<AgentMutationResult>(agentsUrl(taskId, '', sessionId, cwd), {
      method: 'POST',
      body: JSON.stringify(input)
    }),

  setAgentTool: (
    taskId: string | undefined,
    payload: { filePath?: string; agentId: string; rule: string; enabled: boolean | null },
    sessionId?: string,
    cwd?: string
  ) =>
    request<AgentMutationResult>(agentsUrl(taskId, '/tool', sessionId, cwd), {
      method: 'POST',
      body: JSON.stringify(payload)
    }),

  deleteTaskAgent: (taskId: string | undefined, filePath: string, sessionId?: string, cwd?: string) =>
    request<AgentMutationResult>(agentsUrl(taskId, '', sessionId, cwd), {
      method: 'DELETE',
      body: JSON.stringify({ filePath })
    })
};
