import test from 'node:test';
import assert from 'node:assert';
import { handleBoardTool } from '../../../server/mcp/handler.js';
import { BOARD_MCP_TOOLS, MANAGER_TOOLS, toolsFor } from '../../../server/mcp/tools.js';
import { boardDigest, taskDetail } from '../../../shared/manager/digest.js';
import { MANAGER_TASK_ID } from '../../../shared/manager/identity.js';
import { BoardColumn } from '../../../shared/types.js';
import { question, task } from '../../fixtures/boardTasks.js';

const columns = [{ id: 'execute', title: 'In progress' }] as BoardColumn[];

function fakeBoard(taskId = MANAGER_TASK_ID) {
  const calls: { method: string; url: string; body?: Record<string, unknown> }[] = [];
  const fetchFn: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method || 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    if (url.endsWith('/api/manager/overview')) {
      const digest = boardDigest([task({ id: 'TASK-7', title: 'Login', pendingRequest: question })], columns, 0);
      return new Response(JSON.stringify(digest), { status: 200 });
    }
    if (url.includes('/api/manager/tasks/TASK-7')) {
      return new Response(JSON.stringify({ ...taskDetail(task({ id: 'TASK-7' }), columns), now: 0 }), { status: 200 });
    }
    if (method === 'POST' && url.endsWith('/api/tasks/TASK-7/prompt')) {
      return new Response(JSON.stringify(task({ id: 'TASK-7', queued: [{ id: 'q', prompt: body.prompt, queuedAt: 0 }] })), { status: 200 });
    }
    return new Response(JSON.stringify({ error: `No task at ${url}` }), { status: 404 });
  };
  return { calls, ctx: { boardUrl: 'http://127.0.0.1:3002', taskId, fetchFn } };
}

function text(result: { content: { text: string }[] }): string {
  return result.content.map((item) => item.text).join('');
}

test('only the manager is offered the manager tools', () => {
  assert.strictEqual(toolsFor(MANAGER_TASK_ID), MANAGER_TOOLS);
  assert.strictEqual(toolsFor('TASK-1'), BOARD_MCP_TOOLS);
});

test('an ordinary task cannot call a manager tool', async () => {
  const { calls, ctx } = fakeBoard('TASK-1');
  const result = await handleBoardTool('prompt_task', { taskId: 'TASK-7', prompt: 'go' }, ctx);
  assert.equal(result.isError, true);
  assert.equal(calls.length, 0);
});

test('board_overview renders the digest the board made', async () => {
  const { ctx } = fakeBoard();
  const result = await handleBoardTool('board_overview', {}, ctx);
  assert.notEqual(result.isError, true);
  assert.match(text(result), /## Blocked on the user\n- TASK-7 "Login"/);
});

test('task_detail takes a lower-case id and caps the turns it asks for', async () => {
  const { calls, ctx } = fakeBoard();
  const result = await handleBoardTool('task_detail', { taskId: 'task-7', turns: 500 }, ctx);
  assert.match(text(result), /## Original request/);
  assert.match(calls[0]?.url ?? '', /\/api\/manager\/tasks\/TASK-7\?turns=30$/);
});

test('prompt_task sends the message and says when it was queued', async () => {
  const { calls, ctx } = fakeBoard();
  const result = await handleBoardTool('prompt_task', { taskId: 'TASK-7', prompt: ' run the tests ' }, ctx);
  assert.deepStrictEqual(calls[0]?.body, { prompt: 'run the tests' });
  assert.match(text(result), /^Sent to TASK-7\. It is queued/);
});

test('the manager cannot prompt itself, and a missing task is an error', async () => {
  const { calls, ctx } = fakeBoard();
  const self = await handleBoardTool('prompt_task', { taskId: 'manager', prompt: 'hi' }, ctx);
  assert.equal(self.isError, true);
  assert.equal(calls.length, 0);

  const missing = await handleBoardTool('task_detail', { taskId: 'TASK-99' }, ctx);
  assert.equal(missing.isError, true);
});
