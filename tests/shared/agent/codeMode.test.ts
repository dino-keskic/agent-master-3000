import test from 'node:test';
import assert from 'node:assert';
import { codeModeCalls, codeModeTarget, summarizeCodeModeCalls } from '../../../shared/agent/codeMode.js';

/** What OpenCode 2.0.24 sent over ACP for a Code Mode call, in the sandbox. */
const script = 'const a = await tools["echo-board"].echo({ text: "hi" });\nreturn a;';
const finished = {
  toolCalls: [{ tool: 'echo-board.echo', status: 'completed', input: { text: 'hi' } }],
  truncated: false
};

test('a finished call says what it ran', () => {
  assert.deepStrictEqual(codeModeCalls({ name: 'execute', rawInput: { code: script } }, finished), ['echo-board.echo']);
});

test('the report wins over the script, which may call a tool in a loop or not at all', () => {
  const report = { toolCalls: [{ tool: 'a.x' }, { tool: 'a.x' }, { tool: 'nodot' }, {}] };
  assert.deepStrictEqual(codeModeCalls({ name: 'execute', rawInput: { code: 'tools.b.y()' } }, report), ['a.x', 'a.x']);
});

test('while it runs, the script is read for its call sites, however they are spelled', () => {
  const code = [
    'await tools.acpecho.echo({})',
    'await tools["echo-board"]["echo"]({})',
    "await tools['web'].fetch_page({})",
    'await tools . spaced . call ()',
    'const t = tools.acpecho; // not a call',
    'mytools.x.y()'
  ].join('\n');
  assert.deepStrictEqual(codeModeCalls({ name: 'execute', rawInput: { code } }), [
    'acpecho.echo', 'echo-board.echo', 'web.fetch_page', 'spaced.call'
  ]);
});

test('only Code Mode is read, and a call with no script yet ran nothing known', () => {
  assert.strictEqual(codeModeCalls({ name: 'shell', rawInput: { code: 'tools.a.b()' } }, finished), undefined);
  assert.strictEqual(codeModeCalls({ name: 'execute', rawInput: {} }), undefined);
  assert.deepStrictEqual(codeModeCalls({ name: 'execute', rawInput: { code: 'return 1' } }), []);
});

test('a call names its server up to the first dot, and OpenCode’s own helpers are not MCP tools', () => {
  assert.deepStrictEqual(codeModeTarget('echo-board.echo'), { server: 'echo-board', tool: 'echo' });
  assert.deepStrictEqual(codeModeTarget('srv.tool.v2'), { server: 'srv', tool: 'tool.v2' });
  assert.strictEqual(codeModeTarget('opencode.list_mcp_resources'), undefined);
  assert.strictEqual(codeModeTarget('.x'), undefined);
  assert.strictEqual(codeModeTarget('x.'), undefined);
});

test('the gist names the first tool and counts the other ones', () => {
  assert.strictEqual(summarizeCodeModeCalls([]), null);
  assert.strictEqual(summarizeCodeModeCalls(['a.x', 'a.x']), 'a.x');
  assert.strictEqual(summarizeCodeModeCalls(['a.x', 'b.y', 'a.x', 'c.z']), 'a.x +2 more');
});
