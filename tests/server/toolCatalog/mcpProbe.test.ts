import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { clearMcpToolsCache, listLocalMcpTools, listLocalMcpToolsAll } from '../../../server/toolCatalog/mcpProbe.js';
import { FIXTURES_DIR } from '../../fixtures/paths.js';

/**
 * Asking local MCP servers for their tools, against a stand-in that is slow to
 * start the way an `npx` server is. What is measured is how many times the
 * board waits for one: once per server, all at once, and never again for a
 * server it has already asked — whichever folder the asking is for.
 */

const SLOW_MCP = path.join(FIXTURES_DIR, 'slowMcp.mjs');
const DELAY_MS = 700;

function setup() {
  clearMcpToolsCache();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-mcp-probe-'));
  const starts = path.join(dir, 'starts');
  const server = (tools: string) => ({
    command: [process.execPath, SLOW_MCP, String(DELAY_MS), tools],
    environment: { SLOW_MCP_STARTS: starts }
  });
  const startCount = () => (fs.existsSync(starts) ? fs.readFileSync(starts, 'utf8').trim().split('\n').length : 0);
  return { dir, server, startCount };
}

test('servers are asked all at once, so the wait is the slowest, not the sum', async () => {
  const { dir, server, startCount } = setup();
  const began = Date.now();
  const lists = await listLocalMcpToolsAll(
    { one: server('alpha'), two: server('beta,gamma'), three: server('delta') },
    dir
  );
  const took = Date.now() - began;
  assert.deepStrictEqual(lists.get('one'), ['alpha']);
  assert.deepStrictEqual(lists.get('two'), ['beta', 'gamma']);
  assert.deepStrictEqual(lists.get('three'), ['delta']);
  assert.strictEqual(startCount(), 3);
  assert.ok(took < DELAY_MS * 2, `three ${DELAY_MS}ms starts took ${took}ms`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a server's answer is kept for every folder, and asked for once while it is coming", async () => {
  const { dir, server, startCount } = setup();
  const entry = server('alpha');
  for (const name of ['worktree-a', 'worktree-b', 'worktree-c']) fs.mkdirSync(path.join(dir, name));
  const [first, second] = await Promise.all([
    listLocalMcpTools(entry, path.join(dir, 'worktree-a')),
    listLocalMcpTools(entry, path.join(dir, 'worktree-b'))
  ]);
  assert.deepStrictEqual(first, ['alpha']);
  assert.deepStrictEqual(second, ['alpha']);
  assert.strictEqual(startCount(), 1, 'two panels at once start it once');

  assert.deepStrictEqual(await listLocalMcpTools(entry, path.join(dir, 'worktree-c')), ['alpha']);
  assert.strictEqual(startCount(), 1, 'a new worktree does not start it again');

  clearMcpToolsCache();
  await listLocalMcpTools(entry, dir);
  assert.strictEqual(startCount(), 2, 'the refresh button does');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a server that cannot be started is unreachable, not empty', async () => {
  clearMcpToolsCache();
  assert.strictEqual(await listLocalMcpTools({ command: ['/nonexistent/mcp-server'] }, os.tmpdir()), null);
});
