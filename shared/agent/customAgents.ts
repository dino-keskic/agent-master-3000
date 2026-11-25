import { parseFrontmatter, serializeFrontmatter } from './frontmatter.js';
import {
  SessionTool,
  SessionToolInventory,
  decidingRule,
  matchesToolPattern,
  resolveToolState,
  sortTools
} from './tools.js';

/**
 * Custom agents as OpenCode defines them (markdown files in `.opencode/agents/`
 * or `~/.config/opencode/agents/`, `opencode.json` entries, and built-ins),
 * plus pure helpers for parsing, serializing, and resolving per-agent tools.
 *
 * Pure: disk I/O lives in `server/opencode/customAgents.ts`.
 */

export type AgentScope = 'project' | 'global' | 'builtin';
export type AgentSourceKind = 'markdown' | 'config' | 'builtin';
export type AgentMode = 'primary' | 'subagent' | 'all';

export interface CustomAgent {
  key: string;
  id: string;
  name: string;
  scope: AgentScope;
  sourceKind: AgentSourceKind;
  filePath?: string;
  locationLabel: string;
  shadowedBy?: string;
  editable: boolean;
  description: string;
  mode?: AgentMode | (string & {});
  model?: string;
  temperature?: number;
  steps?: number;
  color?: string;
  hidden?: boolean;
  disabled?: boolean;
  prompt: string;
  /** Tool rules declared directly on this agent (from `tools:` and whole-tool `permission`/`permissions`). */
  tools: Record<string, boolean>;
  /** Effective tool rules from OpenCode's resolved snapshot for this agent, when available. */
  resolvedTools?: Record<string, boolean>;
  /** True when `permission` or `permissions` holds resource-specific patterns (e.g. `bash: { "git *": "allow" }`). */
  hasGranularPermissions?: boolean;
  rawMarkdown?: string;
  extraFrontmatter?: Record<string, unknown>;
}

export interface AgentInventory {
  cwd: string;
  agents: CustomAgent[];
  /** Non-markdown agents' board-level tool overrides, keyed by agent id. */
  agentToolPolicy: Record<string, Record<string, boolean>>;
  pendingRestart: boolean;
  projectDir: string;
  globalDir: string;
}

export interface SaveAgentInput {
  /** Existing filePath when updating an existing markdown agent, or undefined when creating. */
  filePath?: string;
  id: string;
  scope: 'project' | 'global';
  description: string;
  mode?: string;
  model?: string;
  temperature?: number;
  steps?: number;
  color?: string;
  hidden?: boolean;
  disabled?: boolean;
  prompt: string;
  tools: Record<string, boolean>;
  extraFrontmatter?: Record<string, unknown>;
  /** When set, saves this exact markdown content instead of serializing fields. */
  rawMarkdown?: string;
}

export interface AgentMutationResult {
  agent?: CustomAgent;
  inventory: AgentInventory;
  /** True when the ACP process could not be restarted automatically because turns are in flight. */
  pendingRestart: boolean;
}

const KNOWN_FRONTMATTER_KEYS = new Set([
  'name',
  'description',
  'mode',
  'model',
  'temperature',
  'steps',
  'maxSteps',
  'color',
  'hidden',
  'disable',
  'disabled',
  'tools',
  'permission',
  'permissions'
]);

const PREFERRED_FRONTMATTER_ORDER = [
  'description',
  'mode',
  'model',
  'temperature',
  'steps',
  'color',
  'hidden',
  'disable',
  'tools',
  'permission',
  'permissions'
] as const;

export function isValidAgentId(id: string): boolean {
  const trimmed = id.trim();
  if (!trimmed || trimmed.length > 120) return false;
  if (trimmed.startsWith('/') || trimmed.endsWith('/') || trimmed.includes('..') || trimmed.includes('\\')) {
    return false;
  }
  return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(trimmed);
}

export function slugifyAgentId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-/]+|[-/]+$/g, '');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function effectToBoolean(effect: unknown): boolean | undefined {
  if (effect === 'deny') return false;
  if (effect === 'allow' || effect === 'ask') return true;
  return undefined;
}

/**
 * Extract a flat `tool -> boolean` map from OpenCode's `tools`, `permission`,
 * and `permissions` frontmatter fields, and flag whether granular resource
 * patterns exist that should be preserved untouched.
 */
export function extractAgentToolsFromFrontmatter(data: Record<string, unknown>): {
  tools: Record<string, boolean>;
  hasGranularPermissions: boolean;
} {
  const tools: Record<string, boolean> = {};
  let hasGranularPermissions = false;

  const permObj = asRecord(data.permission);
  for (const [action, value] of Object.entries(permObj)) {
    if (typeof value === 'string') {
      const bool = effectToBoolean(value);
      if (bool !== undefined) tools[action] = bool;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [resource, effect] of Object.entries(value as Record<string, unknown>)) {
        if (resource === '*') {
          const bool = effectToBoolean(effect);
          if (bool !== undefined) tools[action] = bool;
        } else {
          hasGranularPermissions = true;
        }
      }
    }
  }

  if (Array.isArray(data.permissions)) {
    for (const entry of data.permissions) {
      const rec = asRecord(entry);
      if (typeof rec.action !== 'string') continue;
      if (rec.resource === undefined || rec.resource === '*') {
        const bool = effectToBoolean(rec.effect);
        if (bool !== undefined) tools[rec.action] = bool;
      } else {
        hasGranularPermissions = true;
      }
    }
  }

  for (const [key, value] of Object.entries(asRecord(data.tools))) {
    if (typeof value === 'boolean') tools[key] = value;
  }

  return { tools, hasGranularPermissions };
}

export function parseAgentMarkdown(
  raw: string,
  meta: {
    id: string;
    scope: 'project' | 'global';
    filePath: string;
    locationLabel: string;
  }
): CustomAgent {
  const parsed = parseFrontmatter(raw);
  const { data, body } = parsed;
  const { tools, hasGranularPermissions } = extractAgentToolsFromFrontmatter(data);

  const extraFrontmatter: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!KNOWN_FRONTMATTER_KEYS.has(key) || key === 'permission' || key === 'permissions') {
      if (!KNOWN_FRONTMATTER_KEYS.has(key) || key === 'permission' || key === 'permissions') {
        if (!KNOWN_FRONTMATTER_KEYS.has(key)) extraFrontmatter[key] = value;
      }
    }
  }
  if (data.permission !== undefined) extraFrontmatter.permission = data.permission;
  if (data.permissions !== undefined) extraFrontmatter.permissions = data.permissions;
  if (typeof data.name === 'string' && data.name.trim()) extraFrontmatter.name = data.name;

  const rawSteps = typeof data.steps === 'number' ? data.steps : typeof data.maxSteps === 'number' ? data.maxSteps : undefined;

  return {
    key: `${meta.scope}:${meta.filePath}`,
    id: meta.id,
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : meta.id,
    scope: meta.scope,
    sourceKind: 'markdown',
    filePath: meta.filePath,
    locationLabel: meta.locationLabel,
    editable: true,
    description: typeof data.description === 'string' ? data.description : '',
    mode: typeof data.mode === 'string' && data.mode.trim() ? data.mode.trim() : undefined,
    model: typeof data.model === 'string' && data.model.trim() ? data.model.trim() : undefined,
    temperature: typeof data.temperature === 'number' ? data.temperature : undefined,
    steps: rawSteps,
    color: typeof data.color === 'string' && data.color.trim() ? data.color.trim() : undefined,
    hidden: typeof data.hidden === 'boolean' ? data.hidden : undefined,
    disabled: typeof data.disable === 'boolean' ? data.disable : typeof data.disabled === 'boolean' ? data.disabled : undefined,
    prompt: body,
    tools,
    hasGranularPermissions,
    rawMarkdown: raw,
    ...(Object.keys(extraFrontmatter).length > 0 ? { extraFrontmatter } : {})
  };
}

/**
 * Clean any conflicting whole-tool `permission` / `permissions` entries for `rule`
 * when a user updates a tool toggle on a markdown agent, while preserving granular
 * resource-specific rules (e.g. `bash: { "git status*": "allow" }`).
 */
export function cleanPermissionConflict(
  extra: Record<string, unknown> | undefined,
  rule: string
): Record<string, unknown> | undefined {
  if (!extra) return extra;
  const next = { ...extra };

  if (next.permission && typeof next.permission === 'object' && !Array.isArray(next.permission)) {
    const perm = { ...(next.permission as Record<string, unknown>) };
    for (const key of Object.keys(perm)) {
      if (!matchesToolPattern(rule, key) && !matchesToolPattern(key, rule)) continue;
      const val = perm[key];
      if (typeof val === 'string') {
        delete perm[key];
      } else if (val && typeof val === 'object' && !Array.isArray(val)) {
        const nested = { ...(val as Record<string, unknown>) };
        delete nested['*'];
        if (Object.keys(nested).length === 0) delete perm[key];
        else perm[key] = nested;
      }
    }
    if (Object.keys(perm).length === 0) delete next.permission;
    else next.permission = perm;
  }

  if (Array.isArray(next.permissions)) {
    const filtered = next.permissions.filter((entry) => {
      const rec = asRecord(entry);
      if (typeof rec.action !== 'string') return true;
      const isWhole = rec.resource === undefined || rec.resource === '*';
      return !(isWhole && (matchesToolPattern(rule, rec.action) || matchesToolPattern(rec.action, rule)));
    });
    if (filtered.length === 0) delete next.permissions;
    else next.permissions = filtered;
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

export function serializeAgentMarkdown(input: {
  description?: string;
  mode?: string;
  model?: string;
  temperature?: number;
  steps?: number;
  color?: string;
  hidden?: boolean;
  disabled?: boolean;
  tools?: Record<string, boolean>;
  prompt: string;
  extraFrontmatter?: Record<string, unknown>;
}): string {
  const data: Record<string, unknown> = { ...(input.extraFrontmatter || {}) };

  const setOrDelete = (key: string, value: unknown) => {
    if (value === undefined || value === '' || value === false) delete data[key];
    else data[key] = value;
  };

  if (input.description && input.description.trim()) data.description = input.description.trim();
  else delete data.description;

  setOrDelete('mode', input.mode?.trim() || undefined);
  setOrDelete('model', input.model?.trim() || undefined);
  if (typeof input.temperature === 'number' && Number.isFinite(input.temperature)) data.temperature = input.temperature;
  else delete data.temperature;

  if (typeof input.steps === 'number' && Number.isFinite(input.steps) && input.steps > 0) {
    data.steps = Math.round(input.steps);
  } else {
    delete data.steps;
  }
  delete data.maxSteps;

  setOrDelete('color', input.color?.trim() || undefined);
  setOrDelete('hidden', input.hidden ? true : undefined);
  setOrDelete('disable', input.disabled ? true : undefined);
  delete data.disabled;

  const cleanTools = Object.fromEntries(
    Object.entries(input.tools || {}).filter(([, val]) => typeof val === 'boolean')
  );
  if (Object.keys(cleanTools).length > 0) data.tools = cleanTools;
  else delete data.tools;

  return serializeFrontmatter(data, input.prompt, PREFERRED_FRONTMATTER_ORDER);
}

/**
 * Update one rule in an agent's `tools` map.
 *
 * - `enabled === null`: removes the explicit key for `rule`.
 * - `enabled === true | false`: if removing `rule` already resolves to `enabled`
 *   via another rule in `tools` (or default `true` when there is no wildcard),
 *   keep the map minimal by deleting `rule` rather than writing redundant entries.
 */
export function setAgentToolRule(
  current: Record<string, boolean> | undefined,
  rule: string,
  enabled: boolean | null
): Record<string, boolean> {
  const next = { ...(current || {}) };
  if (enabled === null) {
    delete next[rule];
    return next;
  }

  if (!rule.includes('*')) {
    const without = { ...next };
    delete without[rule];
    const inherited = decidingRule(without, rule)?.value ?? true;
    if (inherited === enabled) {
      return without;
    }
  } else {
    // When setting a wildcard like `server_*`, drop narrower rules that now agree with it.
    for (const key of Object.keys(next)) {
      if (key !== rule && key.length > rule.length && matchesToolPattern(rule, key) && next[key] === enabled) {
        delete next[key];
      }
    }
  }

  next[rule] = enabled;
  return next;
}

/**
 * Build a tool inventory for a specific agent from the session's tool catalog,
 * folding in that agent's own `tools` map and any board-level `agentToolPolicy`.
 */
export function resolveAgentToolInventory(
  baseInventory: SessionToolInventory,
  agent: Pick<CustomAgent, 'id' | 'tools' | 'resolvedTools' | 'sourceKind'>,
  agentToolPolicy?: Record<string, boolean>
): SessionToolInventory {
  // For markdown agents we trust the live draft/file `tools` map; for built-in/config
  // agents we start from OpenCode's resolved map and layer the board's agent policy over it.
  const agentTools =
    agent.sourceKind === 'markdown'
      ? agent.tools
      : { ...(agent.resolvedTools || agent.tools), ...(agentToolPolicy || {}) };

  const tools: SessionTool[] = baseInventory.tools.map((tool) => {
    if (tool.disabledBy === 'server' || tool.disabledBy === 'plugin') return tool;
    const state = resolveToolState(tool.name, {
      tools: baseInventory.globalTools,
      agentTools,
      policy: baseInventory.policy,
      overrides: baseInventory.overrides
    });
    const ownRule = decidingRule(agentTools, tool.name);
    const policyRule = agent.sourceKind !== 'markdown' ? decidingRule(agentToolPolicy, tool.name) : undefined;
    return {
      ...tool,
      ...state,
      // Expose whether this agent itself has an explicit rule (so the UI can offer Undo/Reset).
      ...(ownRule ? { agentRule: ownRule } : {}),
      ...(policyRule ? { policy: policyRule.value } : {})
    };
  });

  return {
    ...baseInventory,
    agent: agent.id,
    tools: sortTools(tools)
  };
}

export function filterCustomAgents(agents: CustomAgent[], filter: string): CustomAgent[] {
  const needle = filter.trim().toLowerCase();
  if (!needle) return agents;
  return agents.filter(
    (agent) =>
      agent.id.toLowerCase().includes(needle) ||
      agent.name.toLowerCase().includes(needle) ||
      agent.description.toLowerCase().includes(needle) ||
      agent.locationLabel.toLowerCase().includes(needle)
  );
}

export function groupCustomAgents(agents: CustomAgent[]): {
  project: CustomAgent[];
  global: CustomAgent[];
  builtin: CustomAgent[];
} {
  const project: CustomAgent[] = [];
  const global: CustomAgent[] = [];
  const builtin: CustomAgent[] = [];
  for (const agent of agents) {
    if (agent.scope === 'project') project.push(agent);
    else if (agent.scope === 'global') global.push(agent);
    else builtin.push(agent);
  }
  return { project, global, builtin };
}
