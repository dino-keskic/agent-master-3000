import { spawn } from 'child_process';
import readline from 'readline';
import { toolPolicySignature } from '../../shared/agent/tools.js';
import { opencodeEnv } from '../opencode/env.js';
import { childBaseEnv, opencodeBin } from '../setup/locations.js';
import { cwdCache } from './cache.js';

/**
 * What OpenCode itself says it has.
 *
 * There is no "what tools does this session have" call — the ACP session
 * exposes only model and agent. So the board starts a short-lived
 * `opencode serve`, asks it for the tool registry, MCP status and the resolved
 * config, and shuts it down again.
 *
 * Everything here is best-effort: a failed read becomes a warning on the panel,
 * never an error on the path of running a turn.
 */

const SERVE_START_TIMEOUT_MS = 25_000;
const HTTP_TIMEOUT_MS = 20_000;

export interface McpConfigEntry {
  type?: string;
  enabled?: boolean;
  command?: string[];
  url?: string;
  environment?: Record<string, string>;
}

export interface OpencodeSnapshot {
  toolIds: string[];
  mcpStatus: Record<string, { status?: string }>;
  mcpConfig: Record<string, McpConfigEntry>;
  tools: Record<string, boolean>;
  agents: Record<string, { tools?: Record<string, boolean> }>;
  warnings: string[];
}

const snapshotCache = cwdCache<OpencodeSnapshot>();

export function clearOpencodeCache(cwd?: string): void {
  snapshotCache.clear(cwd);
}

/**
 * Start `opencode serve` on an ephemeral port and hand its base URL to `use`.
 *
 * Port 0 lets the OS pick, and the chosen one is only knowable from the
 * process's own startup line — hardcoding a port would collide with whatever
 * else the user is running.
 */
async function withOpencodeServer<T>(
  cwd: string,
  policy: Record<string, boolean> | undefined,
  use: (baseUrl: string) => Promise<T>
): Promise<T> {
  // Same overlay the agent runs with, so the panel resolves the same list.
  const child = spawn(opencodeBin(), ['serve', '--port', '0', '--hostname', '127.0.0.1'], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: opencodeEnv(childBaseEnv(), policy)
  });

  const stop = () => {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  };

  try {
    const baseUrl = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('opencode serve did not start in time')), SERVE_START_TIMEOUT_MS);
      const done = (err: Error | null, url?: string) => {
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(url!);
      };

      const watch = (stream: NodeJS.ReadableStream | null) => {
        if (!stream) return;
        readline.createInterface({ input: stream }).on('line', (line) => {
          const match = /listening on (http:\/\/\S+)/i.exec(line);
          if (match?.[1]) done(null, match[1].replace(/\/+$/, ''));
        });
      };
      watch(child.stdout);
      watch(child.stderr);

      child.on('error', (e) => done(e));
      child.on('exit', (code) => done(new Error(`opencode serve exited (code ${code})`)));
    });

    return await use(baseUrl);
  } finally {
    stop();
  }
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asBooleanMap(value: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [key, entry] of Object.entries(asRecord(value))) {
    if (typeof entry === 'boolean') out[key] = entry;
  }
  return out;
}

export async function readOpencode(cwd: string, policy: Record<string, boolean> | undefined): Promise<OpencodeSnapshot> {
  // The policy is part of what OpenCode resolves, so it is part of the key.
  const cacheKey = `${cwd}::${toolPolicySignature(policy)}`;
  const cached = snapshotCache.get(cacheKey);
  if (cached) return cached;

  const warnings: string[] = [];
  const snapshot = await withOpencodeServer(cwd, policy, async (baseUrl) => {
    const dir = `directory=${encodeURIComponent(cwd)}`;
    const [ids, status, config, agents] = await Promise.all([
      getJson(`${baseUrl}/experimental/tool/ids?${dir}`).catch((e) => {
        warnings.push(`Could not read the tool registry (${e.message}).`);
        return [];
      }),
      getJson(`${baseUrl}/mcp?${dir}`).catch((e) => {
        warnings.push(`Could not read MCP status (${e.message}).`);
        return {};
      }),
      getJson(`${baseUrl}/config?${dir}`).catch((e) => {
        warnings.push(`Could not read the resolved config (${e.message}).`);
        return {};
      }),
      getJson(`${baseUrl}/agent?${dir}`).catch(() => [])
    ]);

    const configRecord = asRecord(config);
    const agentMap: Record<string, { tools?: Record<string, boolean> }> = {};
    for (const [name, entry] of Object.entries(asRecord(configRecord.agent))) {
      agentMap[name] = { tools: asBooleanMap(asRecord(entry).tools) };
    }
    // `/agent` resolves inherited and file-defined agents that the raw config
    // never spells out, so it fills in the ones the config map is missing.
    for (const entry of Array.isArray(agents) ? agents : []) {
      const name = asRecord(entry).name;
      if (typeof name !== 'string' || agentMap[name]) continue;
      agentMap[name] = { tools: asBooleanMap(asRecord(entry).tools) };
    }

    const mcpConfig: Record<string, McpConfigEntry> = {};
    for (const [name, entry] of Object.entries(asRecord(configRecord.mcp))) {
      const record = asRecord(entry);
      mcpConfig[name] = {
        type: typeof record.type === 'string' ? record.type : undefined,
        enabled: record.enabled !== false,
        command: Array.isArray(record.command) ? record.command.filter((c): c is string => typeof c === 'string') : undefined,
        url: typeof record.url === 'string' ? record.url : undefined,
        environment: asRecord(record.environment) as Record<string, string>
      };
    }

    return {
      toolIds: Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [],
      mcpStatus: asRecord(status) as Record<string, { status?: string }>,
      mcpConfig,
      tools: asBooleanMap(configRecord.tools),
      agents: agentMap,
      warnings
    };
  });

  snapshotCache.set(cacheKey, snapshot);
  return snapshot;
}
