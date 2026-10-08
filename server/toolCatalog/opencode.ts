import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import readline from 'readline';
import { toolPolicySignature } from '../../shared/agent/tools.js';
import { McpConfigEntry, V2_BUILTIN_TOOLS, readV2ToolConfig } from '../../shared/toolCatalog/opencodeV2.js';
import { opencodeEnv } from '../opencode/env.js';
import { livePolicyFile } from '../opencode/policyFile.js';
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
 * OpenCode 2 answers the same questions under `/api/` in a different shape;
 * `/api/info` says which one is listening (1.x serves its web app there), and
 * `shared/toolCatalog/opencodeV2.ts` reads the 2.x answers.
 *
 * Everything here is best-effort: a failed read becomes a warning on the panel,
 * never an error on the path of running a turn.
 */

const SERVE_START_TIMEOUT_MS = 25_000;
const HTTP_TIMEOUT_MS = 20_000;
/** 2.x loads a directory's agents and MCP servers on its first request about it. */
const V2_LOAD_TIMEOUT_MS = 10_000;
const V2_LOAD_POLL_MS = 250;

export interface OpencodeSnapshot {
  toolIds: string[];
  mcpStatus: Record<string, { status?: string }>;
  mcpConfig: Record<string, McpConfigEntry>;
  tools: Record<string, boolean>;
  agents: Record<string, { tools?: Record<string, boolean> }>;
  /** 2.x: what the documents OpenCode merges after the board's file say, which outvote it. */
  overrides?: Record<string, boolean>;
  warnings: string[];
}

const snapshotCache = cwdCache<OpencodeSnapshot>();

export function clearOpencodeCache(cwd?: string): void {
  snapshotCache.clear(cwd);
}

interface OpencodeServer {
  get(path: string): Promise<unknown>;
}

/**
 * Start `opencode serve` on an ephemeral port and hand it to `use`.
 *
 * Port 0 lets the OS pick, and the chosen one is only knowable from the
 * process's own startup line — hardcoding a port would collide with whatever
 * else the user is running.
 *
 * The server gets a password of its own, which both 1.x and 2.x honour: it
 * can read the user's config and sessions, and anything else on the machine
 * could otherwise ask it to for as long as it is up. (2.x makes one up when
 * none is given, and only says so in a log.)
 */
async function withOpencodeServer<T>(
  cwd: string,
  policy: Record<string, boolean> | undefined,
  use: (server: OpencodeServer, policyFile: string | undefined) => Promise<T>
): Promise<T> {
  const password = randomBytes(24).toString('base64url');
  const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
  // Same delivery the agent runs with — overlay or file — so the panel
  // resolves the same list.
  const base = childBaseEnv();
  const policyFile = livePolicyFile(opencodeBin(), base, policy);
  const child = spawn(opencodeBin(), ['serve', '--port', '0', '--hostname', '127.0.0.1'], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...opencodeEnv(base, policy, policyFile), OPENCODE_SERVER_PASSWORD: password }
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

    return await use({ get: (path) => getJson(`${baseUrl}${path}`, authorization) }, policyFile);
  } finally {
    stop();
  }
}

async function getJson(url: string, authorization: string): Promise<unknown> {
  const res = await fetch(url, { headers: { authorization }, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** The version 2.x reports, or null — 1.x answers `/api/info` with its web app's HTML. */
async function v2Version(server: OpencodeServer): Promise<string | null> {
  const info = asRecord(await server.get('/api/info').catch(() => null));
  return typeof info.version === 'string' && /^2\./.test(info.version) ? info.version : null;
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
  const snapshot = await withOpencodeServer(cwd, policy, async (server, policyFile) =>
    (await v2Version(server)) ? readV2(server, cwd, warnings, policyFile) : readV1(server, cwd, warnings)
  );

  snapshotCache.set(cacheKey, snapshot);
  return snapshot;
}

async function readV1(server: OpencodeServer, cwd: string, warnings: string[]): Promise<OpencodeSnapshot> {
  const dir = `directory=${encodeURIComponent(cwd)}`;
  const [ids, status, config, agents] = await Promise.all([
    server.get(`/experimental/tool/ids?${dir}`).catch((e) => {
      warnings.push(`Could not read the tool registry (${e.message}).`);
      return [];
    }),
    server.get(`/mcp?${dir}`).catch((e) => {
      warnings.push(`Could not read MCP status (${e.message}).`);
      return {};
    }),
    server.get(`/config?${dir}`).catch((e) => {
      warnings.push(`Could not read the resolved config (${e.message}).`);
      return {};
    }),
    server.get(`/agent?${dir}`).catch(() => [])
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
}

/**
 * 2.x has no tool registry to ask, and answers about a directory with empty
 * lists until it has loaded it — every directory has agents, so the agent
 * list filling in is the sign it has.
 */
async function readV2(
  server: OpencodeServer,
  cwd: string,
  warnings: string[],
  policyFile: string | undefined
): Promise<OpencodeSnapshot> {
  const location = `location%5Bdirectory%5D=${encodeURIComponent(cwd)}`;
  const deadline = Date.now() + V2_LOAD_TIMEOUT_MS;
  let agents: unknown = null;
  for (;;) {
    agents = await server.get(`/api/agent?${location}`).catch(() => null);
    const data = asRecord(agents).data;
    if (Array.isArray(data) && data.length > 0) break;
    if (Date.now() >= deadline) {
      warnings.push('OpenCode did not finish loading this folder in time; agents and MCP servers may be missing.');
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, V2_LOAD_POLL_MS));
  }
  const [mcp, config] = await Promise.all([
    server.get(`/api/mcp?${location}`).catch((e) => {
      warnings.push(`Could not read MCP status (${e.message}).`);
      return null;
    }),
    server.get(`/api/config?${location}`).catch((e) => {
      warnings.push(`Could not read the resolved config (${e.message}).`);
      return null;
    })
  ]);
  const read = readV2ToolConfig(config, agents, mcp, policyFile);
  return { toolIds: [...V2_BUILTIN_TOOLS], ...read, warnings };
}
