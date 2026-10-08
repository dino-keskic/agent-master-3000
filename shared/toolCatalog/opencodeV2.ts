import { decidingRule, matchesToolPattern } from '../agent/tools.js';

/**
 * What OpenCode 2's server says about tools, read into the shape the tools
 * panel already understands from 1.x.
 *
 * 2.x moved its HTTP API under `/api/` and changed what it says:
 *
 * - There is no tool registry endpoint any more, so the built-ins are the list
 *   2.x sends the model (`V2_BUILTIN_TOOLS`). MCP tools are not on that list —
 *   they are called from inside `execute`, its Code Mode runtime — but they are
 *   still named `<server>_<tool>` in config, and turning one off that way still
 *   takes it out of the runtime (both verified in the sandbox on 2.0.24).
 * - The `tools` on/off map became permission rules: `{ tools: { grep: false } }`
 *   reads back as `{ action: 'grep', resource: '*', effect: 'deny' }`, `bash`
 *   as `shell`, and `write` as `edit` — and a denied `edit` hides `write` too.
 * - `/api/config` is the list of documents that were merged, in order, rather
 *   than the merged result; the last one to speak about a tool wins.
 *
 * What belongs here: turning those responses into tool maps and MCP entries.
 * Starting the server and fetching is `server/toolCatalog/opencode.ts`.
 */

/** The built-in tools OpenCode 2.0.24 offers a model, in the order it lists them. */
export const V2_BUILTIN_TOOLS = [
  'edit', 'glob', 'grep', 'question', 'read', 'shell', 'skill', 'subagent', 'webfetch', 'websearch', 'write', 'execute'
];

/** Tools a permission covers besides its namesake. */
const PERMISSION_COVERS: Record<string, string[]> = { edit: ['edit', 'write'] };

export interface McpConfigEntry {
  type?: string;
  enabled?: boolean;
  command?: string[];
  url?: string;
  environment?: Record<string, string>;
}

export interface V2ToolConfig {
  tools: Record<string, boolean>;
  agents: Record<string, { tools?: Record<string, boolean> }>;
  mcpConfig: Record<string, McpConfigEntry>;
  mcpStatus: Record<string, { status?: string }>;
  /**
   * When the board's switches came in its own file: what the documents merged
   * after it say, which outvote the board for the tools they name.
   */
  overrides?: Record<string, boolean>;
}

interface PermissionRule {
  action: string;
  resource?: string;
  effect: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function rulesOf(value: unknown): PermissionRule[] {
  return asArray(value)
    .map(asRecord)
    .filter((rule) => typeof rule.action === 'string' && typeof rule.effect === 'string')
    .map((rule) => ({
      action: rule.action as string,
      resource: typeof rule.resource === 'string' ? rule.resource : undefined,
      effect: rule.effect as string
    }));
}

/**
 * The on/off map a list of rules amounts to, in the board's terms
 * (`decidingRule`): an exact name beats a pattern. OpenCode instead lets the
 * last matching rule win, so a pattern clears whatever it covers before it is
 * set — `*` deny after `grep` allow is a `grep` that is off.
 *
 * Only a rule over every resource turns a tool on or off: one about `*.env` is
 * a narrower question the agent asks at the time. `ask` leaves the tool there
 * to be asked about, so it counts as on.
 */
export function toolMapFromRules(rules: PermissionRule[], into: Record<string, boolean> = {}): Record<string, boolean> {
  for (const rule of rules) {
    if (rule.resource !== undefined && rule.resource !== '*') continue;
    if (rule.effect !== 'deny' && rule.effect !== 'allow' && rule.effect !== 'ask') continue;
    const on = rule.effect !== 'deny';
    for (const tool of PERMISSION_COVERS[rule.action] || [rule.action]) {
      if (tool.includes('*')) {
        for (const key of Object.keys(into)) if (matchesToolPattern(tool, key)) delete into[key];
      }
      into[tool] = on;
    }
  }
  return into;
}

/** Everything is on unless something says otherwise, so a `*` allow says nothing. */
function withoutDefault(map: Record<string, boolean>): Record<string, boolean> {
  if (map['*'] === true) delete map['*'];
  return map;
}

/**
 * Leave out of an agent's map whatever would come out the same without it —
 * from the agent's other entries, else the global map, else on — so the panel
 * names the config as the reason a tool is off rather than the agent, and the
 * agent's built-in allows (`question`, `external_directory`) are not noise.
 */
function ownEntries(agent: Record<string, boolean>, global: Record<string, boolean>): Record<string, boolean> {
  const own = { ...agent };
  for (const [name, value] of Object.entries(agent)) {
    const rest = { ...own };
    delete rest[name];
    const without = decidingRule(rest, name)?.value ?? decidingRule(global, name)?.value ?? true;
    if (without === value) delete own[name];
  }
  return own;
}

function mcpEntry(raw: unknown): McpConfigEntry {
  const record = asRecord(raw);
  const environment = asRecord(record.environment);
  return {
    type: typeof record.type === 'string' ? record.type : undefined,
    enabled: record.disabled !== true && record.enabled !== false,
    command: Array.isArray(record.command) ? record.command.filter((c): c is string => typeof c === 'string') : undefined,
    url: typeof record.url === 'string' ? record.url : undefined,
    environment: Object.fromEntries(
      Object.entries(environment).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    )
  };
}

/**
 * Read `/api/config`, `/api/agent` and `/api/mcp` (their bodies as parsed JSON).
 *
 * `/api/agent` answers with each agent's rules fully resolved, in the order
 * OpenCode weighs them — its built-in defaults, then the agent's own, then
 * the config's global rules, which so have the last word (2.0.24 in the
 * sandbox) — so that list is what decides an agent's tools. The global map
 * comes from the config documents alone.
 *
 * `boardFile` is the board's own policy file, when the switches went there
 * (`policyDelivery.ts`). It is merged before the project's config, so the
 * documents after it are kept apart as `overrides`. The `*` allow is kept in
 * those: a later document allowing everything really does turn a switch back
 * on.
 */
export function readV2ToolConfig(config: unknown, agents: unknown, mcp: unknown, boardFile?: string): V2ToolConfig {
  const tools: Record<string, boolean> = {};
  const mcpConfig: Record<string, McpConfigEntry> = {};
  let overrides: Record<string, boolean> | undefined;
  for (const doc of asArray(config)) {
    const record = asRecord(doc);
    const info = asRecord(record.info);
    const rules = rulesOf(info.permissions);
    toolMapFromRules(rules, tools);
    if (overrides) toolMapFromRules(rules, overrides);
    else if (boardFile && record.path === boardFile) overrides = {};
    for (const [name, server] of Object.entries(asRecord(asRecord(info.mcp).servers))) {
      mcpConfig[name] = { ...mcpConfig[name], ...mcpEntry(server) };
    }
  }
  withoutDefault(tools);

  const agentMap: Record<string, { tools?: Record<string, boolean> }> = {};
  for (const entry of asArray(asRecord(agents).data)) {
    const agent = asRecord(entry);
    const id = typeof agent.id === 'string' ? agent.id : typeof agent.name === 'string' ? agent.name : undefined;
    if (!id) continue;
    agentMap[id] = { tools: ownEntries(withoutDefault(toolMapFromRules(rulesOf(agent.permissions))), tools) };
  }

  const mcpStatus: Record<string, { status?: string }> = {};
  for (const entry of asArray(asRecord(mcp).data)) {
    const server = asRecord(entry);
    if (typeof server.name !== 'string') continue;
    const status = asRecord(server.status).status;
    mcpStatus[server.name] = { status: typeof status === 'string' ? status : undefined };
  }

  return { tools, agents: agentMap, mcpConfig, mcpStatus, ...(overrides ? { overrides } : {}) };
}
