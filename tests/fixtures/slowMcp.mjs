#!/usr/bin/env node
/**
 * A local MCP server that takes its time to start, the way an `npx` one does:
 * `node slowMcp.mjs <delay ms> <tool,tool…>`. Each start is appended to the
 * file named by `SLOW_MCP_STARTS`, so a test can count them.
 *
 * stdout is the protocol.
 */
import fs from 'fs';
import readline from 'readline';

const delay = Number(process.argv[2] || 0);
const tools = (process.argv[3] || '').split(',').filter(Boolean);
if (process.env.SLOW_MCP_STARTS) fs.appendFileSync(process.env.SLOW_MCP_STARTS, `${process.pid}\n`);

const reply = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    await new Promise((resolve) => setTimeout(resolve, delay));
    reply(msg.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'slow', version: '1' } });
  }
  if (msg.method === 'tools/list') reply(msg.id, { tools: tools.map((name) => ({ name, inputSchema: { type: 'object' } })) });
});
