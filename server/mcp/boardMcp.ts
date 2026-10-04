/**
 * Stdio MCP server that gives the agent the board's own view of the task it is
 * working on: the changelog comments left on its changes, and the tickets, PRs
 * and pages the task is linked to.
 *
 * Spawned by OpenCode from `session/new` / `session/load`. Talks back to the
 * board over HTTP, so everything it reads and writes stays in board state — the
 * comments are local review notes, not GitHub ones, and a link the agent adds
 * is on the card the moment it is written.
 *
 * This file is the transport: JSON-RPC in and out over stdio, and the spawn
 * description OpenCode is handed. What the tools *are* is in `server/mcp/`.
 *
 * stdout is the protocol — log only to stderr.
 */

import readline from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';
import { BOARD_MCP_NAME, BOARD_MCP_TOOLS } from './tools.js';
import { BoardMcpContext, handleBoardTool } from './handler.js';
import { IS_BUNDLED, SERVER_BUNDLE_DIR, listenAddress } from '../app/appPaths.js';
import { boardToken } from '../http/requestGuard.js';
import { localBoardUrl } from '../../shared/http/requestGuard.js';

export interface AcpMcpServer {
  name: string;
  command: string;
  args: string[];
  env: { name: string; value: string }[];
}

/**
 * How OpenCode is told to start this file, bound to one task. From a checkout
 * that is this very `.ts` under `tsx`; in the built app, where there is no
 * `tsx`, it is the bundle `scripts/build-server.mjs` makes of it.
 *
 * In the desktop app `process.execPath` is the Electron binary, which opens a
 * second copy of the app unless it is told to behave as plain Node.
 */
export function boardMcpServer(taskId: string, bundled = IS_BUNDLED, electron = !!process.versions.electron): AcpMcpServer {
  const args = bundled
    ? [path.join(SERVER_BUNDLE_DIR, 'boardMcp.mjs')]
    : [path.join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'), fileURLToPath(new URL('./boardMcp.ts', import.meta.url))];
  const { port, host } = listenAddress();
  const token = boardToken();
  return {
    name: BOARD_MCP_NAME,
    command: process.execPath,
    args,
    env: [
      { name: 'AGENT_MASTER_MCP', value: '1' },
      { name: 'AGENT_MASTER_URL', value: localBoardUrl(host, port) },
      { name: 'AGENT_MASTER_TASK_ID', value: taskId },
      ...(token ? [{ name: 'AGENT_MASTER_TOKEN', value: token }] : []),
      ...(electron ? [{ name: 'ELECTRON_RUN_AS_NODE', value: '1' }] : [])
    ]
  };
}

function writeMessage(msg: unknown): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

async function handleRpc(msg: {
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
}): Promise<void> {
  const { id, method, params } = msg;
  if (!method) return;

  const ctx: BoardMcpContext = {
    boardUrl: process.env.AGENT_MASTER_URL || 'http://127.0.0.1:3001',
    taskId: process.env.AGENT_MASTER_TASK_ID || '',
    token: process.env.AGENT_MASTER_TOKEN || undefined
  };

  if (method === 'initialize') {
    writeMessage({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: BOARD_MCP_NAME, version: '1.0.0' }
      }
    });
    return;
  }

  if (method === 'notifications/initialized' || method === 'initialized') return;

  if (method === 'ping') {
    if (id !== undefined) writeMessage({ jsonrpc: '2.0', id, result: {} });
    return;
  }

  if (method === 'tools/list') {
    writeMessage({ jsonrpc: '2.0', id, result: { tools: BOARD_MCP_TOOLS } });
    return;
  }

  if (method === 'tools/call') {
    const name = typeof params?.name === 'string' ? params.name : '';
    const args =
      params?.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments)
        ? (params.arguments as Record<string, unknown>)
        : {};
    const result = await handleBoardTool(name, args, ctx);
    writeMessage({ jsonrpc: '2.0', id, result });
    return;
  }

  if (id !== undefined) {
    writeMessage({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` }
    });
  }
}

function runStdio(): void {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: { id?: string | number; method?: string; params?: Record<string, unknown> };
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return;
    }
    void handleRpc(msg).catch((e) => {
      process.stderr.write(`[board-mcp] ${e instanceof Error ? e.message : e}\n`);
    });
  });
}

if (process.env.AGENT_MASTER_MCP === '1') runStdio();
