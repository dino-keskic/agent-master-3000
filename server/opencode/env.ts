import { boardConfigOverlay } from '../../shared/agent/tools.js';

/**
 * The environment OpenCode is started with, board policy included.
 *
 * `OPENCODE_CONFIG_CONTENT` is a config document OpenCode merges over the files
 * it found — verified in the sandbox: a `tools` map passed this way drops the
 * tool from the request that reaches the model, and everything else in the
 * user's config (providers, MCP servers, agents) survives untouched.
 *
 * On OpenCode 2 the policy goes in a file instead (`policyFile`, written by
 * `policyFile.ts`), which it keeps watching; the content would outrank the
 * file and freeze it, so then it carries none of the policy.
 *
 * Both the agent process and the short-lived server the Tools panel reads from
 * go through here, so the panel shows the same list the agent will run with.
 */
export function opencodeEnv(
  base: NodeJS.ProcessEnv,
  policy: Record<string, boolean> | undefined,
  policyFile?: string,
  agentPolicy?: Record<string, Record<string, boolean>>,
  skillPolicy?: Record<string, boolean>
): NodeJS.ProcessEnv {
  // The board's token is for clients of the board, not for the agent's shell.
  if ('BOARD_TOKEN' in base) {
    const { BOARD_TOKEN: _token, ...rest } = base;
    base = rest;
  }
  if (policyFile) return { ...base, OPENCODE_CONFIG: policyFile };
  const overlay = boardConfigOverlay(policy, agentPolicy, skillPolicy);
  if (!overlay.tools && !overlay.agent && !overlay.permission) return base;

  // Anything the user set by hand stays; the board only adds its tool/agent/skill maps.
  let existing: Record<string, unknown> = {};
  if (base.OPENCODE_CONFIG_CONTENT) {
    try {
      const parsed = JSON.parse(base.OPENCODE_CONFIG_CONTENT);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) existing = parsed;
    } catch {
      // Not ours to repair — drop it rather than start the agent with garbage.
    }
  }

  const existingTools =
    existing.tools && typeof existing.tools === 'object' && !Array.isArray(existing.tools)
      ? (existing.tools as Record<string, boolean>)
      : {};
  const existingAgent =
    existing.agent && typeof existing.agent === 'object' && !Array.isArray(existing.agent)
      ? (existing.agent as Record<string, Record<string, unknown>>)
      : {};
  const existingPermission =
    existing.permission && typeof existing.permission === 'object' && !Array.isArray(existing.permission)
      ? (existing.permission as Record<string, unknown>)
      : {};
  const existingSkillPermission =
    existingPermission.skill &&
    typeof existingPermission.skill === 'object' &&
    !Array.isArray(existingPermission.skill)
      ? (existingPermission.skill as Record<string, unknown>)
      : {};

  const mergedAgent: Record<string, unknown> = { ...existingAgent };
  for (const [id, entry] of Object.entries(overlay.agent || {})) {
    const prev = existingAgent[id] && typeof existingAgent[id] === 'object' ? existingAgent[id] : {};
    const prevTools =
      prev.tools && typeof prev.tools === 'object' && !Array.isArray(prev.tools)
        ? (prev.tools as Record<string, boolean>)
        : {};
    mergedAgent[id] = { ...prev, tools: { ...prevTools, ...entry.tools } };
  }

  return {
    ...base,
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      ...existing,
      ...(overlay.tools || Object.keys(existingTools).length > 0
        ? { tools: { ...existingTools, ...(overlay.tools || {}) } }
        : {}),
      ...(Object.keys(mergedAgent).length > 0 ? { agent: mergedAgent } : {}),
      ...(overlay.permission
        ? {
            permission: {
              ...existingPermission,
              skill: { ...existingSkillPermission, ...overlay.permission.skill }
            }
          }
        : {})
    })
  };
}
