import test from 'node:test';
import assert from 'node:assert';
import { boardMcpServer } from '../../../server/mcp/boardMcp.js';
import { BOARD_MCP_TOOLS } from '../../../server/mcp/tools.js';
import { handleBoardTool } from '../../../server/mcp/handler.js';
import { TaskLink } from '../../../shared/types.js';
import { buildTaskLink, mergeTaskLinks } from '../../../shared/task/links.js';

interface FakeComment {
  id: string;
  path: string;
  newLine?: number;
  side: string;
  snippet: string;
  body: string;
  author: string;
  createdAt: number;
  replies: { id: string; author: string; body: string; createdAt: number }[];
  resolvedAt?: number;
}

function fakeBoard(comments: FakeComment[]) {
  const calls: { method: string; url: string; body?: Record<string, unknown> }[] = [];
  const fetchFn: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method || 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    if (method === 'GET') {
      return new Response(JSON.stringify({ changelogComments: comments }), { status: 200 });
    }
    if (method === 'POST' && url.endsWith('/comments/respond')) {
      const applied: unknown[] = [];
      const missing: string[] = [];
      for (const response of body.responses as { commentId: string; reply?: string; status?: string }[]) {
        const comment = comments.find((item) => item.id === response.commentId);
        if (!comment) {
          missing.push(response.commentId);
          continue;
        }
        if (response.reply) {
          comment.replies.push({ id: `r${comment.replies.length}`, author: body.author, body: response.reply, createdAt: 2 });
        }
        if (response.status === 'resolved') comment.resolvedAt = 3;
        if (response.status === 'open') delete comment.resolvedAt;
        applied.push({ commentId: comment.id, replied: !!response.reply, status: response.status });
      }
      return new Response(JSON.stringify({ applied, missing }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: `unexpected ${method} ${url}` }), { status: 500 });
  };
  return { calls, ctx: { boardUrl: 'http://127.0.0.1:3002', taskId: 'TASK-1', fetchFn } };
}

function comment(id: string, body: string): FakeComment {
  return {
    id,
    path: 'src/a.ts',
    newLine: 4,
    side: 'add',
    snippet: '+ const x = 1',
    body,
    author: 'user',
    createdAt: 1,
    replies: []
  };
}

test('boardMcpServer points OpenCode at this task over stdio', () => {
  const server = boardMcpServer('TASK-155');
  assert.strictEqual(server.name, 'agent-master-3000');
  assert.ok(server.args.some((arg) => arg.endsWith('boardMcp.ts')));
  const env = Object.fromEntries(server.env.map((item) => [item.name, item.value]));
  assert.strictEqual(env.AGENT_MASTER_MCP, '1');
  assert.strictEqual(env.AGENT_MASTER_TASK_ID, 'TASK-155');
  assert.match(env.AGENT_MASTER_URL || '', /^http:\/\//);
});

test('the built app points OpenCode at the bundled MCP entry, not at tsx', () => {
  const server = boardMcpServer('TASK-155', true);
  assert.strictEqual(server.command, process.execPath);
  assert.strictEqual(server.args.length, 1);
  assert.match(server.args[0] || '', /dist-server[\\/]boardMcp\.mjs$/);
});

test('the advertised tools are the comment ones, the link ones and the workspace ones', () => {
  assert.deepStrictEqual(
    BOARD_MCP_TOOLS.map((tool) => tool.name),
    [
      'list_changelog_comments',
      'respond_to_changelog_comments',
      'list_task_links',
      'save_task_links',
      'remove_task_link',
      'list_workspaces',
      'move_session'
    ]
  );
});

test("a board with a token gets it on every call, and one without gets no header", async () => {
  const seen: (string | null)[] = [];
  const fetchFn: typeof fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Headers(init?.headers).get('authorization'));
    return new Response(JSON.stringify({ changelogComments: [] }), { status: 200 });
  };
  const ctx = { boardUrl: 'http://127.0.0.1:3002', taskId: 'TASK-1', fetchFn };
  await handleBoardTool('list_changelog_comments', {}, { ...ctx, token: 's3cret' });
  await handleBoardTool('list_changelog_comments', {}, ctx);
  assert.deepStrictEqual(seen, ['Bearer s3cret', null]);
});

test('list_changelog_comments renders every open note with its id and thread', async () => {
  const resolved = comment('c2', 'already handled');
  resolved.resolvedAt = 9;
  const { calls, ctx } = fakeBoard([comment('c1', 'rename this'), resolved]);

  const listed = await handleBoardTool('list_changelog_comments', {}, ctx);
  assert.ok(!listed.isError);
  const text = listed.content[0]!.text;
  assert.match(text, /1 open changelog comment\./);
  assert.match(text, /\[c1\] src\/a\.ts:4\n {4}\+ const x = 1\n {2}User: rename this/);
  assert.doesNotMatch(text, /already handled/);
  assert.strictEqual(calls.filter((call) => call.method === 'GET').length, 1);

  const all = await handleBoardTool('list_changelog_comments', { status: 'all' }, ctx);
  assert.match(all.content[0]!.text, /already handled/);
  assert.match(all.content[0]!.text, /\[c2\] src\/a\.ts:4 · resolved/);
});

test('respond_to_changelog_comments replies and resolves many notes in one board call', async () => {
  const comments = [comment('c1', 'rename this'), comment('c2', 'add a test'), comment('c3', 'leave open')];
  const { calls, ctx } = fakeBoard(comments);

  const result = await handleBoardTool(
    'respond_to_changelog_comments',
    {
      responses: [
        { commentId: 'c1', reply: 'renamed', status: 'resolved' },
        { commentId: 'c2', status: 'resolved' },
        { commentId: 'c3', reply: 'still looking' },
        { commentId: 'gone', reply: 'who?' }
      ]
    },
    ctx
  );

  assert.ok(!result.isError);
  const text = result.content[0]!.text;
  assert.match(text, /c1: replied and resolved/);
  assert.match(text, /c2: resolved/);
  assert.match(text, /c3: replied/);
  assert.match(text, /Not found \(already deleted\?\): gone/);

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0]!.body?.author, 'agent');
  assert.strictEqual(comments[0]!.replies[0]!.body, 'renamed');
  assert.strictEqual(comments[0]!.resolvedAt, 3);
  assert.strictEqual(comments[1]!.resolvedAt, 3);
  assert.strictEqual(comments[2]!.resolvedAt, undefined);
});

test('the old single-comment tool names still route to the batch endpoint', async () => {
  const comments = [comment('c1', 'rename this')];
  const { calls, ctx } = fakeBoard(comments);

  await handleBoardTool('reply_to_changelog_comment', { commentId: 'c1', body: 'done' }, ctx);
  assert.strictEqual(comments[0]!.replies[0]!.body, 'done');

  await handleBoardTool('resolve_changelog_comment', { commentId: 'c1' }, ctx);
  assert.strictEqual(comments[0]!.resolvedAt, 3);

  await handleBoardTool('reopen_changelog_comment', { commentId: 'c1' }, ctx);
  assert.strictEqual(comments[0]!.resolvedAt, undefined);

  assert.ok(calls.every((call) => call.url.endsWith('/comments/respond')));
});

test('a response with no id, or nothing to do, is refused instead of reported as applied', async () => {
  const { calls, ctx } = fakeBoard([comment('c1', 'rename this')]);

  const noId = await handleBoardTool('respond_to_changelog_comments', { responses: [{ reply: 'hi' }] }, ctx);
  assert.strictEqual(noId.isError, true);
  assert.match(noId.content[0]!.text, /commentId/);

  const noop = await handleBoardTool('respond_to_changelog_comments', { responses: [{ commentId: 'c1' }] }, ctx);
  assert.strictEqual(noop.isError, true);

  const legacy = await handleBoardTool('reply_to_changelog_comment', { body: 'hi' }, ctx);
  assert.strictEqual(legacy.isError, true);

  assert.strictEqual(calls.length, 0);
});

/** A board that answers the link routes the way server/index.ts does. */
function fakeLinkBoard(links: TaskLink[]) {
  const calls: { method: string; url: string; body?: Record<string, unknown> }[] = [];
  const fetchFn: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method || 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });

    if (method === 'GET' && url.endsWith('/links')) {
      return new Response(JSON.stringify({ links }), { status: 200 });
    }
    if (method === 'POST' && url.endsWith('/links')) {
      const built = (body.links as { url: string; title?: string; note?: string }[]).flatMap((input, i) => {
        const link = buildTaskLink(input, `new${i}`, body.source, 100);
        return link ? [link] : [];
      });
      const rejected = (body.links as { url: string }[])
        .filter((input) => !buildTaskLink(input, 'x'))
        .map((input) => input.url);
      const result = mergeTaskLinks(links, built);
      links.splice(0, links.length, ...result.links);
      return new Response(
        JSON.stringify({ added: result.added, updated: result.updated, rejected, links }),
        { status: 200 }
      );
    }
    if (method === 'DELETE') {
      const id = decodeURIComponent(url.split('/').pop() || '');
      const index = links.findIndex((link) => link.id === id);
      if (index < 0) return new Response(JSON.stringify({ error: 'Link not found' }), { status: 404 });
      links.splice(index, 1);
      return new Response(JSON.stringify({ id: 'TASK-1' }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: `unexpected ${method} ${url}` }), { status: 500 });
  };
  return { calls, ctx: { boardUrl: 'http://127.0.0.1:3002', taskId: 'TASK-1', fetchFn } };
}

test('list_task_links reads back the ticket, the PR and their ids', async () => {
  const { ctx } = fakeLinkBoard([
    buildTaskLink({ url: 'https://github.com/acme/web/pull/9404', note: 'opened by this task' }, 'l2', 'agent', 2)!,
    buildTaskLink({ url: 'https://acme.atlassian.net/browse/AB-1', title: 'Login loops' }, 'l1', 'prompt', 1)!
  ]);

  const listed = await handleBoardTool('list_task_links', {}, ctx);
  assert.ok(!listed.isError);
  const text = listed.content[0]!.text;
  assert.match(text, /2 links on this task\./);
  // Trackers first, and Jira before the PR.
  assert.ok(text.indexOf('AB-1') < text.indexOf('acme/web#9404'));
  assert.match(text, /\[l1\] Jira AB-1 — Login loops\n {2}https:\/\/acme\.atlassian\.net\/browse\/AB-1/);
  assert.match(text, /note: opened by this task/);
});

test('list_task_links on an empty task says how to fill it', async () => {
  const { ctx } = fakeLinkBoard([]);
  const listed = await handleBoardTool('list_task_links', {}, ctx);
  assert.ok(!listed.isError);
  assert.match(listed.content[0]!.text, /save_task_links/);
});

test('save_task_links writes a batch in one board call and re-saving edits in place', async () => {
  const links: TaskLink[] = [];
  const { calls, ctx } = fakeLinkBoard(links);

  const saved = await handleBoardTool(
    'save_task_links',
    {
      links: [
        { url: 'https://github.com/acme/web/pull/9404', note: 'opened by this task' },
        { url: 'https://acme.atlassian.net/browse/AB-1' },
        { url: 'chatter, not a url' }
      ]
    },
    ctx
  );

  assert.ok(!saved.isError);
  const text = saved.content[0]!.text;
  assert.match(text, /added acme\/web#9404 \[new0\]/);
  assert.match(text, /added AB-1 \[new1\]/);
  assert.match(text, /Not a usable http\(s\) URL: chatter, not a url/);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0]!.body?.source, 'agent');
  assert.strictEqual(links.length, 2);

  const again = await handleBoardTool('save_task_links', { links: ['https://github.com/acme/web/pull/9404'] }, ctx);
  assert.strictEqual(again.isError, true);
  assert.match(again.content[0]!.text, /already on the task/);
  assert.strictEqual(links.length, 2);
});

test('save_task_links with nothing to save is refused before it reaches the board', async () => {
  const { calls, ctx } = fakeLinkBoard([]);
  const empty = await handleBoardTool('save_task_links', { links: [] }, ctx);
  assert.strictEqual(empty.isError, true);
  assert.match(empty.content[0]!.text, /url/);
  assert.strictEqual(calls.length, 0);
});

test('remove_task_link needs an id, and reports one the board no longer has', async () => {
  const links = [buildTaskLink({ url: 'https://example.com/a' }, 'l1')!];
  const { ctx } = fakeLinkBoard(links);

  const noId = await handleBoardTool('remove_task_link', {}, ctx);
  assert.strictEqual(noId.isError, true);
  assert.strictEqual(links.length, 1);

  const removed = await handleBoardTool('remove_task_link', { linkId: 'l1' }, ctx);
  assert.ok(!removed.isError);
  assert.strictEqual(links.length, 0);

  const gone = await handleBoardTool('remove_task_link', { linkId: 'l1' }, ctx);
  assert.strictEqual(gone.isError, true);
  assert.match(gone.content[0]!.text, /Link not found/);
});

/** A board that answers the move routes the way server/routes/projectMove.ts does. */
function fakeMoveBoard() {
  const calls: { method: string; url: string; body?: Record<string, unknown> }[] = [];
  const targets = {
    current: { cwd: '/code/agent-master-3000', projectName: 'agent-master-3000' },
    sessions: [{ sessionId: 'ses_1', title: 'Main', cwd: '/code/agent-master-3000', primary: true, running: true }],
    projects: [
      {
        id: 'p1',
        name: 'agent-master-3000',
        path: '/code/agent-master-3000',
        checkouts: [{ path: '/code/agent-master-3000', branch: 'master' }]
      },
      { id: 'p2', name: 'web-app', path: '/code/web-app', checkouts: [{ path: '/code/web-app', branch: 'main' }] }
    ]
  };
  const fetchFn: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method || 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });

    if (method === 'GET' && url.endsWith('/move-targets')) {
      return new Response(JSON.stringify(targets), { status: 200 });
    }
    if (method === 'POST' && url.endsWith('/api/worktrees')) {
      return new Response(
        JSON.stringify({ path: `${body.cwd}.worktrees/${body.name}`, name: body.name }),
        { status: 200 }
      );
    }
    if (method === 'POST' && url.endsWith('/project')) {
      const where = body.cwd || '/code/web-app';
      return new Response(
        JSON.stringify({ id: 'TASK-1', move: { log: `Session "Main" moved to project web-app (${where}).` } }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({ error: `unexpected ${method} ${url}` }), { status: 500 });
  };
  return { calls, ctx: { boardUrl: 'http://127.0.0.1:3002', taskId: 'TASK-1', fetchFn } };
}

test('list_workspaces names every project, its checkouts, and where the task runs now', async () => {
  const { ctx } = fakeMoveBoard();
  const listed = await handleBoardTool('list_workspaces', {}, ctx);
  assert.ok(!listed.isError);
  const text = listed.content[0]!.text;
  assert.match(text, /This task runs in \/code\/agent-master-3000 \(project agent-master-3000\)\./);
  assert.match(text, /- ses_1 \[main, running\] — Main — \/code\/agent-master-3000/);
  assert.match(text, /- web-app \(projectId p2\) — \/code\/web-app/);
  assert.match(text, /\n {4}\/code\/web-app \[main\]/);
});

test('move_session moves the session it is talking through unless told otherwise', async () => {
  const { calls, ctx } = fakeMoveBoard();
  const moved = await handleBoardTool('move_session', { projectId: 'p2' }, ctx);
  assert.ok(!moved.isError);
  // The agent needs to know the move is not felt by the turn it is in.
  assert.match(moved.content[0]!.text, /moved to project web-app.*keeps the folder it started in\./s);
  assert.strictEqual(calls.length, 1);
  assert.match(calls[0]!.url, /\/sessions\/current\/project$/);
  assert.deepStrictEqual(calls[0]!.body, { projectId: 'p2', cwd: null });

  await handleBoardTool('move_session', { sessionId: 'ses_1', cwd: '/code/web-app' }, ctx);
  assert.match(calls[1]!.url, /\/sessions\/ses_1\/project$/);
  assert.deepStrictEqual(calls[1]!.body, { projectId: null, cwd: '/code/web-app' });
});

test('move_session cuts the worktree it was asked for before moving into it', async () => {
  const { calls, ctx } = fakeMoveBoard();
  const moved = await handleBoardTool('move_session', { projectId: 'p2', newWorktree: 'fix-login' }, ctx);
  assert.ok(!moved.isError);
  // Cut from the project being moved into, not from where the session is now.
  // The task rides along so the board can name the branch after its ticket.
  assert.deepStrictEqual(calls[1]!.body, { cwd: '/code/web-app', name: 'fix-login', taskId: 'TASK-1' });
  assert.deepStrictEqual(calls[2]!.body, { projectId: 'p2', cwd: '/code/web-app.worktrees/fix-login' });
  assert.match(moved.content[0]!.text, /web-app\.worktrees\/fix-login/);
});

test('move_session refuses a project id the board does not know', async () => {
  const { calls, ctx } = fakeMoveBoard();
  const failed = await handleBoardTool('move_session', { projectId: 'nope', newWorktree: 'x' }, ctx);
  assert.strictEqual(failed.isError, true);
  assert.match(failed.content[0]!.text, /list_workspaces/);
  // Nothing was cut and nothing was moved.
  assert.strictEqual(calls.filter((call) => call.method === 'POST').length, 0);
});
