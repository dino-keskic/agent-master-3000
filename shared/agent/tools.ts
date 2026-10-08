import { TaskLogItem } from '../types.js';
import { codeModeTarget } from './codeMode.js';

/**
 * What the agent can actually call in a session.
 *
 * OpenCode assembles a turn's tool list from three places: its built-in tool
 * registry, every connected MCP server, and the `tools` maps in the resolved
 * config (global, then the agent's own). The board can read all three, so this
 * module holds the shared shape and the resolution rules; `server/toolCatalog`
 * does the reading and the UI renders the result.
 *
 * The rules below were verified against opencode 1.18.20 by capturing the tool
 * list on the wire to the model (sandbox/README.md explains the rig):
 *
 *   {"tools": {"webfetch": false}}            drops webfetch
 *   {"tools": {"slack_*": false}}             drops one MCP server's tools
 *   {"tools": {"*": false, "read": true}}     allow-list of one
 *   {"agent": {"build": {"tools": {…}}}}      wins over the global map
 *   {"mcp": {"slack": {"enabled": false}}}    drops the server entirely
 */

export type ToolSource = 'builtin' | 'mcp' | 'board';

/** Why a tool is not in the session's list. */
export type ToolDisabledBy =
  /** A `tools` entry in the global config. */
  | 'config'
  /** A `tools` entry on the agent this session runs. */
  | 'agent'
  /** Its MCP server is disabled or not connected. */
  | 'server'
  /** A switch the user flipped on the board's own Tools panel. */
  | 'board';

export type McpServerStatus = 'connected' | 'disabled' | 'failed' | 'needs_auth' | 'unknown';

export interface SessionTool {
  /** The name the model sees — MCP tools arrive as `server_tool`. */
  name: string;
  source: ToolSource;
  /** MCP server this came from, for `mcp` and `board` tools. */
  server?: string;
  /** The tool's own name, without the server prefix. */
  toolName?: string;
  description?: string;
  enabled: boolean;
  disabledBy?: ToolDisabledBy;
  /** The config key that turned it off, e.g. `*` or `slack_*`. */
  disabledByRule?: string;
  /** The board's own override for this tool, when it has one. */
  policy?: boolean;
  /**
   * The board's override is outvoted: on OpenCode 2 its switches sit in a
   * config file merged before the project's, and that config says otherwise.
   */
  policyOverridden?: boolean;
  /** Calls in the transcript of the session being viewed. */
  used: number;
}

export interface McpServerInfo {
  name: string;
  type: 'local' | 'remote';
  status: McpServerStatus;
  /** The command or URL behind it, for the panel's subtitle. */
  origin?: string;
  /** Set when the board could not list the server's tools. */
  note?: string;
}

export interface SessionToolInventory {
  cwd: string;
  /** The agent (OpenCode "mode") whose tool map applies. */
  agent?: string;
  tools: SessionTool[];
  servers: McpServerInfo[];
  /** Non-fatal problems worth showing above the list. */
  warnings: string[];
  /** Set when OpenCode could not be read at all; `tools` is then empty. */
  error?: string;
  /** The board's overrides, exactly as stored in settings. */
  policy: Record<string, boolean>;
  /** OpenCode 2: what the configs merged after the board's file say (`readV2ToolConfig`). */
  overrides?: Record<string, boolean>;
  /**
   * True when the policy has changed since the agent process started. The list
   * above already reflects the new policy; the running agent does not.
   */
  pendingRestart: boolean;
  generatedAt: number;
}

/** Tools OpenCode registers but never offers to a model. */
const INTERNAL_TOOLS = new Set(['invalid']);

export function isInternalTool(name: string): boolean {
  return INTERNAL_TOOLS.has(name);
}

/** How OpenCode namespaces an MCP server's tools on the wire. */
export function mcpToolName(server: string, tool: string): string {
  return `${server}_${tool}`;
}

/** `slack_*` / `web*` / `*`, the subset of globbing OpenCode's tool keys use. */
export function matchesToolPattern(pattern: string, name: string): boolean {
  if (pattern === name) return true;
  if (!pattern.includes('*')) return false;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(name);
}

/**
 * The entry that decides a tool, or undefined when the map says nothing about
 * it. An exact key beats a pattern, and a longer pattern beats a shorter one,
 * so `{"*": false, "read": true}` enables exactly `read`.
 */
export function decidingRule(
  map: Record<string, boolean> | undefined,
  name: string
): { rule: string; value: boolean } | undefined {
  if (!map) return undefined;
  const exact = map[name];
  if (typeof exact === 'boolean') return { rule: name, value: exact };

  let best: { rule: string; value: boolean } | undefined;
  for (const [rule, value] of Object.entries(map)) {
    if (!rule.includes('*') || !matchesToolPattern(rule, name)) continue;
    if (!best || rule.length > best.rule.length) best = { rule, value };
  }
  return best;
}

type ToolState = Pick<SessionTool, 'enabled' | 'disabledBy' | 'disabledByRule' | 'policy' | 'policyOverridden'>;

/** The board's switch for a tool, unless a config merged after it says otherwise. */
function boardState(name: string, rule: string, value: boolean, overrides?: Record<string, boolean>): ToolState {
  const later = decidingRule(overrides, name);
  if (later && later.value !== value) {
    return later.value
      ? { enabled: true, policy: value, policyOverridden: true }
      : { enabled: false, disabledBy: 'config', disabledByRule: later.rule, policy: value, policyOverridden: true };
  }
  return value ? { enabled: true, policy: true } : { enabled: false, disabledBy: 'board', disabledByRule: rule, policy: false };
}

/**
 * Resolve one tool against the config. The board's own policy is the outermost
 * layer — it is written into the agent's config overlay, which wins over both
 * the file config and the agent's map — except for `overrides`, the configs
 * OpenCode 2 merges after the board's own file. Below that, the agent's map is consulted
 * before the global one: a `build` agent that re-enables `read` keeps it even
 * under a global `*: false`.
 */
export function resolveToolState(
  name: string,
  config: {
    tools?: Record<string, boolean>;
    agentTools?: Record<string, boolean>;
    policy?: Record<string, boolean>;
    overrides?: Record<string, boolean>;
  }
): ToolState {
  const fromBoard = decidingRule(config.policy, name);
  if (fromBoard) return boardState(name, fromBoard.rule, fromBoard.value, config.overrides);

  const fromAgent = decidingRule(config.agentTools, name);
  if (fromAgent) {
    return fromAgent.value
      ? { enabled: true }
      : { enabled: false, disabledBy: 'agent', disabledByRule: fromAgent.rule };
  }

  const fromConfig = decidingRule(config.tools, name);
  if (fromConfig) {
    return fromConfig.value
      ? { enabled: true }
      : { enabled: false, disabledBy: 'config', disabledByRule: fromConfig.rule };
  }

  return { enabled: true };
}

/**
 * How often each tool was called in these logs.
 *
 * Names come from the transcript, which is the only place MCP tools show up
 * under the exact name the model used — worth keeping even for tools the
 * catalog already knows about, and the only evidence for the ones it doesn't.
 * A Code Mode `execute` counts once itself and once for each MCP tool it ran.
 */
export function toolUsage(logs: TaskLogItem[] | undefined, sessionId?: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const log of logs || []) {
    if (log.type !== 'tool_call' || !log.toolCall) continue;
    if (sessionId && log.sessionId && log.sessionId !== sessionId) continue;
    const name = log.toolCall.name.trim();
    if (!name) continue;
    counts[name] = (counts[name] || 0) + 1;
    // Under Code Mode an MCP tool is only ever called from inside `execute`.
    for (const call of log.toolCall.codeModeCalls || []) {
      const target = codeModeTarget(call);
      if (!target) continue;
      const wire = mcpToolName(target.server, target.tool);
      counts[wire] = (counts[wire] || 0) + 1;
    }
  }
  return counts;
}

/**
 * A stable identity for a policy, so the board can tell whether the agent
 * process it started is still running the policy in settings.
 */
export function toolPolicySignature(policy: Record<string, boolean> | undefined): string {
  const entries = Object.entries(policy || {}).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}

/** The OpenCode config the board overlays on the agent process for a policy. */
export function boardConfigOverlay(policy: Record<string, boolean> | undefined): { tools?: Record<string, boolean> } {
  const entries = Object.entries(policy || {});
  return entries.length ? { tools: Object.fromEntries(entries) } : {};
}

/** Enabled first, then most-used, then alphabetical — the order the panel reads best in. */
/**
 * The filter box on the tools panel. It searches descriptions as well as names
 * because that is how you find a tool you only know the purpose of.
 * An empty filter matches everything.
 */
export function filterTools(tools: SessionTool[], filter: string): SessionTool[] {
  const needle = filter.trim().toLowerCase();
  if (!needle) return tools;
  return tools.filter(
    (tool) =>
      tool.name.toLowerCase().includes(needle) || (tool.description || '').toLowerCase().includes(needle)
  );
}

/**
 * Servers with no tool of their own to show — one that failed to start, or one
 * whose tools are all filtered out. A server that still has a matching tool is
 * left to the group that renders those tools.
 */
export function filterServers(
  servers: McpServerInfo[],
  withTools: string[],
  filter: string
): McpServerInfo[] {
  const needle = filter.trim().toLowerCase();
  return servers.filter(
    (server) => !withTools.includes(server.name) && (!needle || server.name.toLowerCase().includes(needle))
  );
}

export function sortTools(tools: SessionTool[]): SessionTool[] {
  return [...tools].sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    if (a.used !== b.used) return b.used - a.used;
    return a.name.localeCompare(b.name);
  });
}

export function groupToolsBySource(tools: SessionTool[]): {
  builtin: SessionTool[];
  byServer: { server: string; source: ToolSource; tools: SessionTool[] }[];
} {
  const builtin: SessionTool[] = [];
  const servers = new Map<string, { server: string; source: ToolSource; tools: SessionTool[] }>();

  for (const tool of sortTools(tools)) {
    if (tool.source === 'builtin' || !tool.server) {
      builtin.push(tool);
      continue;
    }
    const existing = servers.get(tool.server);
    if (existing) existing.tools.push(tool);
    else servers.set(tool.server, { server: tool.server, source: tool.source, tools: [tool] });
  }

  return { builtin, byServer: [...servers.values()] };
}

/**
 * Fold a saved board override into an inventory in place.
 *
 * Re-reading from the server would start another OpenCode instance per switch.
 * The board's policy is the outermost layer of the resolution, so the new state
 * of every tool the rule covers is already known without asking: on means on,
 * and off is off *by the board*, whatever the config underneath says.
 *
 * Clearing an override (`enabled: null`) is the one case that cannot be
 * resolved here — the config below decides again and only a re-read knows what
 * it says — so the tool is shown available until the next read corrects it.
 *
 * `pendingRestart` is the server's answer: an OpenCode 2 agent took the switch
 * live, and has nothing to restart for.
 */
export function applyToolPolicyRule(
  inventory: SessionToolInventory,
  rule: string,
  enabled: boolean | null,
  policy: Record<string, boolean>,
  pendingRestart = true
): SessionToolInventory {
  return {
    ...inventory,
    policy,
    pendingRestart,
    tools: inventory.tools.map((tool) => {
      if (!matchesToolPattern(rule, tool.name)) return tool;
      const cleared: SessionTool = {
        ...tool,
        enabled: true,
        disabledBy: undefined,
        disabledByRule: undefined,
        policy: undefined,
        policyOverridden: undefined
      };
      if (enabled === null) {
        const { policy: _policy, policyOverridden: _overridden, ...rest } = cleared;
        return rest;
      }
      return { ...cleared, ...boardState(tool.name, rule, enabled, inventory.overrides) };
    })
  };
}
