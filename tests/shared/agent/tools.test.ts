import test from 'node:test';
import assert from 'node:assert';
import {
  applyToolPolicyRule,
  boardConfigOverlay,
  decidingRule,
  filterServers,
  filterTools,
  groupToolsBySource,
  matchesToolPattern,
  mcpToolName,
  resolveToolState,
  sortTools,
  toolPolicySignature,
  toolUsage
} from '../../../shared/agent/tools.js';
import { McpServerInfo, SessionTool, SessionToolInventory } from '../../../shared/agent/tools.js';
import { TaskLogItem } from '../../../shared/types.js';

/**
 * The expectations here mirror what opencode 1.18.20 actually put on the wire
 * in the sandbox: each case was checked against the tool list a real turn sent
 * to the model, not against the config schema.
 */

test('matchesToolPattern handles the globs OpenCode tool keys use', () => {
  assert.ok(matchesToolPattern('*', 'bash'));
  assert.ok(matchesToolPattern('web*', 'webfetch'));
  assert.ok(matchesToolPattern('slack_*', 'slack_search'));
  assert.ok(matchesToolPattern('read', 'read'));
  assert.ok(!matchesToolPattern('web*', 'bash'));
  assert.ok(!matchesToolPattern('slack_*', 'slackish'));
  assert.ok(!matchesToolPattern('read', 'readme'));
});

test('a dotted or bracketed tool name is not treated as a regex', () => {
  assert.ok(!matchesToolPattern('a.c', 'abc'));
  assert.ok(matchesToolPattern('a.c', 'a.c'));
});

test('decidingRule prefers an exact key, then the longest pattern', () => {
  const map = { '*': false, 'slack_*': true, slack_search: false };
  assert.deepEqual(decidingRule(map, 'slack_search'), { rule: 'slack_search', value: false });
  assert.deepEqual(decidingRule(map, 'slack_list'), { rule: 'slack_*', value: true });
  assert.deepEqual(decidingRule(map, 'bash'), { rule: '*', value: false });
  assert.equal(decidingRule(undefined, 'bash'), undefined);
  assert.equal(decidingRule({}, 'bash'), undefined);
});

test('an unmentioned tool is on', () => {
  assert.deepEqual(resolveToolState('bash', { tools: { webfetch: false } }), { enabled: true });
});

test('the global map turns a tool off and says which rule did it', () => {
  assert.deepEqual(resolveToolState('webfetch', { tools: { webfetch: false } }), {
    enabled: false,
    disabledBy: 'config',
    disabledByRule: 'webfetch'
  });
});

test('an allow-list leaves only what it names', () => {
  const tools = { '*': false, read: true };
  assert.deepEqual(resolveToolState('read', { tools }), { enabled: true });
  assert.deepEqual(resolveToolState('bash', { tools }), {
    enabled: false,
    disabledBy: 'config',
    disabledByRule: '*'
  });
});

test("the agent's map wins over the global one, in both directions", () => {
  assert.deepEqual(
    resolveToolState('read', { tools: { '*': false }, agentTools: { read: true } }),
    { enabled: true }
  );
  assert.deepEqual(resolveToolState('bash', { tools: {}, agentTools: { bash: false } }), {
    enabled: false,
    disabledBy: 'agent',
    disabledByRule: 'bash'
  });
});

test('a server wildcard drops that MCP server, and only that one', () => {
  const tools = { 'slack_*': false };
  assert.equal(resolveToolState(mcpToolName('slack', 'search'), { tools }).enabled, false);
  assert.equal(resolveToolState(mcpToolName('linear', 'search'), { tools }).enabled, true);
});

test('the board policy overrides both the config and the agent', () => {
  const config = { tools: { bash: true }, agentTools: { bash: true }, policy: { bash: false } };
  assert.deepEqual(resolveToolState('bash', config), {
    enabled: false,
    disabledBy: 'board',
    disabledByRule: 'bash',
    policy: false
  });
});

test('the board policy can switch a tool the config turned off back on', () => {
  assert.deepEqual(
    resolveToolState('webfetch', { tools: { webfetch: false }, policy: { webfetch: true } }),
    { enabled: true, policy: true }
  );
});

test('a board wildcard covers a whole MCP server', () => {
  const policy = { 'slack_*': false };
  assert.equal(resolveToolState('slack_search', { policy }).enabled, false);
  assert.equal(resolveToolState('bash', { policy }).enabled, true);
});

test('toolPolicySignature ignores key order but not content', () => {
  assert.equal(toolPolicySignature({ a: true, b: false }), toolPolicySignature({ b: false, a: true }));
  assert.notEqual(toolPolicySignature({ a: true }), toolPolicySignature({ a: false }));
  assert.equal(toolPolicySignature(undefined), toolPolicySignature({}));
});

test('boardConfigOverlay stays empty when nothing is overridden', () => {
  assert.deepEqual(boardConfigOverlay({}), {});
  assert.deepEqual(boardConfigOverlay({ bash: false }), { tools: { bash: false } });
});

const toolLog = (name: string, sessionId?: string): TaskLogItem => ({
  id: `${name}-${Math.round(Math.random() * 1e6)}`,
  timestamp: 0,
  type: 'tool_call',
  text: '',
  sessionId,
  toolCall: { toolCallId: name, name, status: 'completed' }
});

test('toolUsage counts calls and ignores everything else', () => {
  const logs: TaskLogItem[] = [
    toolLog('bash'),
    toolLog('bash'),
    toolLog('slack_search'),
    { id: 'say', timestamp: 0, type: 'agent_say', text: 'hello' }
  ];
  assert.deepEqual(toolUsage(logs), { bash: 2, slack_search: 1 });
  assert.deepEqual(toolUsage(undefined), {});
});

test('toolUsage keeps to one session when asked, and keeps unstamped logs', () => {
  const logs = [toolLog('bash', 'ses_a'), toolLog('read', 'ses_b'), toolLog('grep')];
  assert.deepEqual(toolUsage(logs, 'ses_a'), { bash: 1, grep: 1 });
});

const tool = (name: string, over: Partial<SessionTool> = {}): SessionTool => ({
  name,
  source: 'builtin',
  enabled: true,
  used: 0,
  ...over
});

test('sortTools puts live tools first, then the most used', () => {
  const sorted = sortTools([
    tool('write'),
    tool('bash', { used: 3 }),
    tool('webfetch', { enabled: false, used: 9 }),
    tool('read', { used: 3 })
  ]).map((t) => t.name);
  assert.deepEqual(sorted, ['bash', 'read', 'write', 'webfetch']);
});

test('the filter box searches what a tool is for, not only its name', () => {
  const tools = [
    tool('bash', { description: 'Run a shell command' }),
    tool('webfetch', { description: 'Read a URL' }),
    tool('slack_search', { source: 'mcp', server: 'slack' })
  ];
  assert.deepEqual(filterTools(tools, '').length, 3, 'an empty filter matches everything');
  assert.deepEqual(filterTools(tools, '  ').length, 3, 'and so does whitespace');
  assert.deepEqual(filterTools(tools, 'SHELL').map((t) => t.name), ['bash'], 'case-insensitive, over descriptions');
  assert.deepEqual(filterTools(tools, 'sla').map((t) => t.name), ['slack_search']);
  assert.deepEqual(filterTools(tools, 'nothing').length, 0);
});

test('a server is listed on its own only when no group already shows it', () => {
  const servers: McpServerInfo[] = [
    { name: 'slack', type: 'local', status: 'connected' },
    { name: 'jira', type: 'remote', status: 'failed' }
  ];
  assert.deepEqual(filterServers(servers, ['slack'], '').map((s) => s.name), ['jira']);
  assert.deepEqual(filterServers(servers, [], '').map((s) => s.name), ['slack', 'jira']);
  assert.deepEqual(
    filterServers(servers, [], 'JIR').map((s) => s.name),
    ['jira'],
    'the filter reaches a server with no tools to match on'
  );
});

test('groupToolsBySource splits built-ins from each server', () => {
  const grouped = groupToolsBySource([
    tool('bash'),
    tool('slack_search', { source: 'mcp', server: 'slack' }),
    tool('slack_list', { source: 'mcp', server: 'slack' }),
    tool('agent-master-3000-changelog_list', { source: 'board', server: 'agent-master-3000-changelog' })
  ]);
  assert.deepEqual(grouped.builtin.map((t) => t.name), ['bash']);
  assert.deepEqual(
    grouped.byServer.map((s) => [s.server, s.tools.length, s.source]),
    [
      ['agent-master-3000-changelog', 1, 'board'],
      ['slack', 2, 'mcp']
    ]
  );
});

function inventory(tools: SessionTool[]): SessionToolInventory {
  return {
    cwd: '/repo',
    tools,
    servers: [],
    warnings: [],
    policy: {},
    pendingRestart: false,
    generatedAt: 0
  };
}

test('applyToolPolicyRule blocks every tool a rule covers', () => {
  const next = applyToolPolicyRule(
    inventory([
      tool('slack_search', { source: 'mcp', server: 'slack' }),
      tool('slack_post', { source: 'mcp', server: 'slack' }),
      tool('bash')
    ]),
    'slack_*',
    false,
    { 'slack_*': false }
  );

  const [search, post, bash] = next.tools;
  assert.strictEqual(search?.enabled, false);
  assert.strictEqual(search?.disabledBy, 'board');
  assert.strictEqual(search?.disabledByRule, 'slack_*');
  assert.strictEqual(post?.enabled, false);
  // Untouched by the rule, and untouched by the fold.
  assert.strictEqual(bash?.enabled, true);
  assert.strictEqual(bash?.disabledBy, undefined);
  // The running agent still has the old list until it is restarted.
  assert.strictEqual(next.pendingRestart, true);
  assert.deepEqual(next.policy, { 'slack_*': false });
});

test('applyToolPolicyRule switches a tool back on over the config', () => {
  const next = applyToolPolicyRule(
    inventory([tool('webfetch', { enabled: false, disabledBy: 'config', disabledByRule: 'webfetch' })]),
    'webfetch',
    true,
    { webfetch: true }
  );
  assert.strictEqual(next.tools[0]?.enabled, true);
  assert.strictEqual(next.tools[0]?.policy, true);
  assert.strictEqual(next.tools[0]?.disabledBy, undefined);
});

test('clearing an override drops it, and waits for a re-read to say more', () => {
  const next = applyToolPolicyRule(
    inventory([tool('webfetch', { enabled: false, policy: false, disabledBy: 'board', disabledByRule: 'webfetch' })]),
    'webfetch',
    null,
    {}
  );
  assert.ok(!('policy' in next.tools[0]!));
  assert.strictEqual(next.tools[0]?.enabled, true);
  assert.strictEqual(next.tools[0]?.disabledBy, undefined);
});
