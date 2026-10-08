import { spawn } from 'child_process';
import readline from 'readline';
import { McpConfigEntry } from '../../shared/toolCatalog/opencodeV2.js';
import { cwdCache } from './cache.js';

const MCP_LIST_TIMEOUT_MS = 10_000;

/** Null when the server could not be reached, which is not the same as none. */
const mcpToolsCache = cwdCache<string[] | null>();

export function clearMcpToolsCache(cwd?: string): void {
  mcpToolsCache.clear(cwd);
}

/**
 * Ask one local MCP server what it exposes.
 *
 * OpenCode does not report a server's tools anywhere — only whether it
 * connected — so the board speaks MCP to it the same way OpenCode does. Remote
 * servers are skipped: they are the ones behind OAuth, and a board panel is no
 * place to start an auth dance.
 */
export async function listLocalMcpTools(entry: McpConfigEntry, cwd: string): Promise<string[] | null> {
  const command = entry.command || [];
  const [bin, ...args] = command;
  if (!bin) return null;

  const cacheKey = `${cwd}::${command.join(' ')}`;
  const cached = mcpToolsCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const result = await new Promise<string[] | null>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, args, {
        cwd,
        stdio: ['pipe', 'pipe', 'ignore'],
        env: { ...process.env, ...(entry.environment || {}) }
      });
    } catch {
      resolve(null);
      return;
    }

    let settled = false;
    const finish = (tools: string[] | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      resolve(tools);
    };
    const timer = setTimeout(() => finish(null), MCP_LIST_TIMEOUT_MS);

    child.on('error', () => finish(null));
    child.on('exit', () => finish(null));

    if (!child.stdout || !child.stdin) {
      finish(null);
      return;
    }

    // A server that exits before reading its input is EPIPE here; it is also
    // just a server with no tools to report.
    child.stdin.on('error', () => finish(null));
    const send = (msg: unknown) => child.stdin!.write(`${JSON.stringify(msg)}\n`);
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let msg: { id?: unknown; result?: { tools?: unknown } } | null;
      try {
        msg = JSON.parse(line) as typeof msg;
      } catch {
        return;
      }
      if (msg?.id === 1) {
        send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
        return;
      }
      if (msg?.id === 2) {
        const tools: unknown[] = Array.isArray(msg.result?.tools) ? msg.result.tools : [];
        const names = tools.map((t) => (t as { name?: unknown } | null)?.name);
        finish(names.filter((name): name is string => typeof name === 'string' && name !== ''));
      }
    });

    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'agent-master-3000', version: '1.0.0' }
      }
    });
  });

  mcpToolsCache.set(cacheKey, result);
  return result;
}
