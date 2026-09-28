#!/usr/bin/env node
/**
 * Stub MCP server for the sandbox.
 *
 * Gives OpenCode a real MCP server to connect to — two tools with schemas, no
 * account, no network, no side effects — so work on tool inventory / tool
 * controls has something to enumerate that is not the user's Slack.
 *
 * stdout is the protocol; log to stderr only.
 */
import readline from 'readline';

const NAME = 'sandbox-echo';

const TOOLS = [
  {
    name: 'echo',
    description: 'Return the text it was given. Exists so the sandbox has a callable MCP tool.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Anything.' } },
      required: ['text']
    }
  },
  {
    name: 'sandbox_info',
    description: 'Report the sandbox paths this MCP server is running with.',
    inputSchema: { type: 'object', properties: {} }
  }
];

function write(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function text(value) {
  return { content: [{ type: 'text', text: value }] };
}

function call(name, args) {
  if (name === 'echo') return text(String(args.text ?? ''));
  if (name === 'sandbox_info') {
    return text(
      JSON.stringify(
        {
          home: process.env.HOME,
          configDir: process.env.OPENCODE_CONFIG_DIR,
          db: process.env.OPENCODE_DB,
          cwd: process.cwd()
        },
        null,
        2
      )
    );
  }
  return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  const { id, method, params } = msg;

  if (method === 'initialize') {
    write({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: NAME, version: '1.0.0' }
      }
    });
    return;
  }
  if (method === 'notifications/initialized' || method === 'initialized') return;
  if (method === 'ping') {
    if (id !== undefined) write({ jsonrpc: '2.0', id, result: {} });
    return;
  }
  if (method === 'tools/list') {
    write({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    return;
  }
  if (method === 'tools/call') {
    write({ jsonrpc: '2.0', id, result: call(params?.name, params?.arguments || {}) });
    return;
  }
  if (id !== undefined) {
    write({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
});
