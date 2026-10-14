import {
  McpServerInfo,
  McpServerStatus,
  SessionTool,
  SessionToolInventory,
  isInternalTool,
  mcpToolName,
  resolveToolState,
  sortTools
} from '../../shared/agent/tools.js';
import { BOARD_MCP_NAME, BOARD_MCP_TOOLS } from '../mcp/tools.js';
import { OpencodeSnapshot, clearOpencodeCache, readOpencode } from './opencode.js';
import { McpConfigEntry } from '../../shared/toolCatalog/opencodeV2.js';
import { clearMcpToolsCache, listLocalMcpToolsAll } from './mcpProbe.js';

/**
 * The tool list a session actually runs with, assembled from every source that
 * knows part of it: OpenCode's registry and resolved config, each local MCP
 * server's own `tools/list`, the board's attached server, and — last — whatever
 * the transcript shows the agent calling that none of the above accounted for.
 *
 * Seen beats guessed: a tool the session demonstrably used is listed even when
 * nothing could enumerate it.
 */

/**
 * Forget everything, so the next read starts over: the refresh button, and a
 * different OpenCode chosen in Settings. The MCP servers' answers go for every
 * folder at once — most are shared between them (`shared/toolCatalog/mcpProbe.ts`).
 */
export function clearToolCatalogCache(cwd?: string): void {
  clearOpencodeCache(cwd);
  clearMcpToolsCache();
}

/**
 * Forget what OpenCode said but keep what each MCP server said: after an agent
 * restart or a config reload OpenCode's answer may be different, while a
 * server's tool list is not — and asking every server again is most of what
 * a cold panel waits for. A server whose command or environment changed is a
 * new key anyway.
 */
export function clearOpencodeSnapshots(): void {
  clearOpencodeCache();
}

function mcpStatusOf(raw: string | undefined, enabled: boolean): McpServerStatus {
  if (!enabled) return 'disabled';
  switch (raw) {
    case 'connected':
      return 'connected';
    case 'disabled':
      return 'disabled';
    case 'failed':
      return 'failed';
    case 'needs_auth':
    case 'needsAuth':
    case 'needs_client_registration':
      return 'needs_auth';
    default:
      return 'unknown';
  }
}

export interface InventoryInput {
  cwd: string;
  /** The agent this session runs, whose `tools` map wins over the global one. */
  agent?: string;
  /** Call counts by tool name, from the session transcript. */
  usage: Record<string, number>;
  /** Set when the board attached its changelog MCP server to this session. */
  includeBoardTools?: boolean;
  /** Re-read OpenCode instead of answering from the five-minute cache. */
  refresh?: boolean;
  /** The board's own tool overrides. */
  policy?: Record<string, boolean>;
  /** True when the running agent predates the current policy. */
  pendingRestart?: boolean;
}

type ResolveState = (name: string) => ReturnType<typeof resolveToolState>;

/** OpenCode's own tools, minus the ones it uses to talk to itself. */
function builtinTools(
  snapshot: OpencodeSnapshot,
  usage: Record<string, number>,
  resolve: ResolveState
): SessionTool[] {
  return snapshot.toolIds
    .filter((id) => !isInternalTool(id))
    .map((id) => ({ name: id, source: 'builtin' as const, ...resolve(id), used: usage[id] || 0 }));
}

/**
 * Every MCP server the config or the running agent knows about, and the tools
 * each contributes.
 *
 * A local server can be asked directly; a remote one cannot, so it is listed
 * with a note saying why its tools are missing rather than silently empty. A
 * server that is down disables its tools without the policy having said so.
 */
async function mcpTools(
  snapshot: OpencodeSnapshot,
  cwd: string,
  usage: Record<string, number>,
  resolve: ResolveState
): Promise<{ tools: SessionTool[]; servers: McpServerInfo[] }> {
  const tools: SessionTool[] = [];
  const servers: McpServerInfo[] = [];
  const names = new Set([...Object.keys(snapshot.mcpConfig), ...Object.keys(snapshot.mcpStatus)]);
  const describe = (name: string) => {
    const entry = snapshot.mcpConfig[name] || {};
    const status = mcpStatusOf(snapshot.mcpStatus[name]?.status, entry.enabled !== false);
    return { entry, status, isLocal: entry.type !== 'remote' && !!entry.command };
  };

  const toAsk: Record<string, McpConfigEntry> = {};
  for (const name of names) {
    const { entry, status, isLocal } = describe(name);
    if (isLocal && status !== 'disabled') toAsk[name] = entry;
  }
  const lists = await listLocalMcpToolsAll(toAsk, cwd);

  for (const name of names) {
    const { entry, status, isLocal } = describe(name);
    const info: McpServerInfo = {
      name,
      type: isLocal ? 'local' : 'remote',
      status,
      origin: isLocal ? entry.command?.join(' ') : entry.url
    };

    let toolNames: string[] | null = null;
    if (isLocal && status !== 'disabled') {
      toolNames = lists.get(name) ?? null;
      if (toolNames === null) info.note = 'The board could not reach this server to list its tools.';
    } else if (!isLocal) {
      info.note =
        status === 'needs_auth'
          ? 'Needs authentication in OpenCode before its tools load.'
          : 'Remote server — its tools show up here once the agent uses them.';
    }

    for (const tool of toolNames || []) {
      const full = mcpToolName(name, tool);
      tools.push({
        name: full,
        source: 'mcp',
        server: name,
        toolName: tool,
        ...(status === 'connected' || status === 'unknown'
          ? resolve(full)
          : { enabled: false, disabledBy: 'server' as const }),
        used: usage[full] || 0
      });
    }

    servers.push(info);
  }

  return { tools, servers };
}

/** The board's own server, which it attaches to every session on a task. */
function boardTools(usage: Record<string, number>, resolve: ResolveState): SessionTool[] {
  return BOARD_MCP_TOOLS.map((tool) => {
    const full = mcpToolName(BOARD_MCP_NAME, tool.name);
    return {
      name: full,
      source: 'board' as const,
      server: BOARD_MCP_NAME,
      toolName: tool.name,
      description: tool.description,
      ...resolve(full),
      used: usage[full] || 0
    };
  });
}

/**
 * Anything the transcript used that no source accounted for — a plugin tool, or
 * a remote MCP server the board cannot enumerate. Seen beats guessed.
 */
function usedButUnlisted(
  usage: Record<string, number>,
  listed: SessionTool[],
  servers: McpServerInfo[],
  resolve: ResolveState
): SessionTool[] {
  const known = new Set(listed.map((t) => t.name));
  const extra: SessionTool[] = [];
  for (const [name, count] of Object.entries(usage)) {
    if (known.has(name) || isInternalTool(name)) continue;
    const server = servers.find((s) => name.startsWith(`${s.name}_`));
    extra.push({
      name,
      source: server ? 'mcp' : 'builtin',
      server: server?.name,
      toolName: server ? name.slice(server.name.length + 1) : undefined,
      ...resolve(name),
      used: count
    });
  }
  return extra;
}

export async function sessionToolInventory(input: InventoryInput): Promise<SessionToolInventory> {
  const { cwd, agent, usage } = input;
  const policy = input.policy || {};
  const base: SessionToolInventory = {
    cwd,
    agent,
    tools: [],
    servers: [],
    warnings: [],
    policy,
    pendingRestart: !!input.pendingRestart,
    generatedAt: Date.now()
  };

  if (input.refresh) clearToolCatalogCache(cwd);

  let snapshot: OpencodeSnapshot;
  try {
    snapshot = await readOpencode(cwd, policy);
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e) };
  }

  // The agent's own tool map wins over the global one, and the board's policy
  // over both, unless a config OpenCode 2 merges after the board's file says
  // otherwise — one resolver so every source below agrees on that order.
  const agentTools = agent ? snapshot.agents[agent]?.tools : undefined;
  const { overrides } = snapshot;
  const resolve: ResolveState = (name) =>
    resolveToolState(name, { tools: snapshot.tools, agentTools, policy, overrides });

  const mcp = await mcpTools(snapshot, cwd, usage, resolve);
  const servers = [...mcp.servers];
  const tools = [...builtinTools(snapshot, usage, resolve), ...mcp.tools];

  if (input.includeBoardTools) {
    servers.push({
      name: BOARD_MCP_NAME,
      type: 'local',
      status: 'connected',
      origin: 'attached by the board to every session on this task'
    });
    tools.push(...boardTools(usage, resolve));
  }

  tools.push(...usedButUnlisted(usage, tools, servers, resolve));

  return {
    ...base,
    tools: sortTools(tools),
    servers,
    warnings: [...snapshot.warnings],
    ...(overrides ? { overrides } : {}),
    generatedAt: Date.now()
  };
}
