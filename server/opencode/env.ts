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
  policyFile?: string
): NodeJS.ProcessEnv {
  // The board's token is for clients of the board, not for the agent's shell.
  if ('BOARD_TOKEN' in base) {
    const { BOARD_TOKEN: _token, ...rest } = base;
    base = rest;
  }
  if (policyFile) return { ...base, OPENCODE_CONFIG: policyFile };
  const overlay = boardConfigOverlay(policy);
  if (!overlay.tools) return base;

  // Anything the user set by hand stays; the board only adds its tool map.
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

  return {
    ...base,
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      ...existing,
      tools: { ...existingTools, ...overlay.tools }
    })
  };
}
