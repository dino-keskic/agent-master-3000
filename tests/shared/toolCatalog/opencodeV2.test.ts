import test from 'node:test';
import assert from 'node:assert';
import { V2_BUILTIN_TOOLS, readV2ToolConfig, toolMapFromRules } from '../../../shared/toolCatalog/opencodeV2.js';

/**
 * Responses shaped as OpenCode 2.0.24's `opencode serve` gave them in the
 * sandbox: `/api/config` is the documents in merge order — the global file,
 * the directory, then the board's overlay from OPENCODE_CONFIG_CONTENT.
 */

const config = [
  {
    type: 'document',
    path: '/sandbox/config/opencode.json',
    info: {
      permissions: [
        { action: 'shell', resource: '*', effect: 'ask' },
        { action: 'webfetch', resource: '*', effect: 'deny' },
        { action: 'read', resource: '*.env', effect: 'deny' }
      ],
      agents: { plan: { permissions: [{ action: 'edit', resource: '*', effect: 'deny' }] } },
      mcp: {
        servers: {
          'sandbox-echo': { type: 'local', command: ['node', '/sandbox/mcp/echo-mcp.mjs'], environment: { ECHO: '1', BAD: 3 } },
          off: { type: 'local', command: ['node', 'off.mjs'], disabled: true },
          remote: { type: 'remote', url: 'https://mcp.example.test/mcp' }
        }
      }
    }
  },
  { type: 'directory', path: '/work/web-app' },
  {
    type: 'document',
    info: {
      permissions: [
        { action: 'webfetch', resource: '*', effect: 'allow' },
        { action: 'sandbox-echo_echo', resource: '*', effect: 'deny' }
      ]
    }
  }
];

// `/api/agent` resolves each agent's rules in the order OpenCode weighs them:
// its built-in defaults, the agent's own, then the config's global rules last.
const defaults = [{ action: '*', resource: '*', effect: 'allow' }];
const globalRules = [
  { action: 'shell', resource: '*', effect: 'ask' },
  { action: 'webfetch', resource: '*', effect: 'deny' },
  { action: 'read', resource: '*.env', effect: 'deny' },
  { action: 'webfetch', resource: '*', effect: 'allow' },
  { action: 'sandbox-echo_echo', resource: '*', effect: 'deny' }
];

const agents = {
  location: { directory: '/work/web-app' },
  data: [
    { id: 'build', name: 'build', mode: 'primary', tools: null, permissions: [...defaults, ...globalRules] },
    { id: 'plan', name: 'plan', permissions: [...defaults, { action: 'edit', resource: '*', effect: 'deny' }, ...globalRules] },
    {
      id: 'explore',
      name: 'explore',
      permissions: [
        ...defaults,
        { action: '*', resource: '*', effect: 'deny' },
        { action: 'grep', resource: '*', effect: 'allow' },
        { action: 'read', resource: '*', effect: 'allow' },
        ...globalRules
      ]
    },
    {
      id: 'reviewer',
      name: 'reviewer',
      permissions: [
        ...defaults,
        { action: 'webfetch', resource: '*', effect: 'deny' },
        { action: 'grep', resource: '*', effect: 'deny' },
        ...globalRules
      ]
    }
  ]
};

const mcp = {
  location: { directory: '/work/web-app' },
  data: [
    { name: 'sandbox-echo', status: { status: 'connected' } },
    { name: 'off', status: { status: 'disabled' }, integrationID: 'int_1' },
    { name: 'broken', status: {} }
  ]
};

test('the built-ins include Code Mode and the 2.x shell', () => {
  assert.ok(V2_BUILTIN_TOOLS.includes('execute'));
  assert.ok(V2_BUILTIN_TOOLS.includes('shell'));
  assert.ok(!V2_BUILTIN_TOOLS.includes('bash'));
});

test('rules over every resource switch tools; narrower ones do not, and an ask is still on', () => {
  assert.deepStrictEqual(
    toolMapFromRules([
      { action: '*', resource: '*', effect: 'deny' },
      { action: 'grep', resource: '*', effect: 'deny' },
      { action: 'read', resource: '*.env', effect: 'deny' },
      { action: 'shell', resource: '*', effect: 'ask' },
      { action: 'glob', effect: 'allow' }
    ]),
    { '*': false, grep: false, shell: true, glob: true }
  );
});

test('a later pattern overrides what came before it', () => {
  assert.deepStrictEqual(
    toolMapFromRules([
      { action: 'grep', resource: '*', effect: 'allow' },
      { action: '*', resource: '*', effect: 'deny' }
    ]),
    { '*': false }
  );
});

test('a denied edit takes write with it', () => {
  assert.deepStrictEqual(toolMapFromRules([{ action: 'edit', resource: '*', effect: 'deny' }]), { edit: false, write: false });
});

test('the last document to speak about a tool wins', () => {
  const read = readV2ToolConfig(config, agents, mcp);
  assert.deepStrictEqual(read.tools, { shell: true, webfetch: true, 'sandbox-echo_echo': false });
});

test('an agent holds what is its own, not the global rules again', () => {
  const read = readV2ToolConfig(config, agents, mcp);
  assert.deepStrictEqual(read.agents.build, { tools: {} });
  assert.deepStrictEqual(read.agents.plan, { tools: { edit: false, write: false } });
});

test('an agent that turns everything off keeps the config entries its pattern would otherwise decide', () => {
  const read = readV2ToolConfig(config, agents, mcp);
  // The echo deny goes: its `*` deny already says so.
  assert.deepStrictEqual(read.agents.explore, {
    tools: { '*': false, grep: true, read: true, shell: true, webfetch: true }
  });
});

test('an allow nothing else contradicts is not the agent’s to report', () => {
  const read = readV2ToolConfig(
    [],
    { data: [{ id: 'build', permissions: [...defaults, { action: 'question', resource: '*', effect: 'allow' }] }] },
    null
  );
  assert.deepStrictEqual(read.agents.build, { tools: {} });
});

test('the config has the last word over an agent', () => {
  const read = readV2ToolConfig(config, agents, mcp);
  // Its webfetch deny is overridden by the config's allow, which it then shares.
  assert.deepStrictEqual(read.agents.reviewer, { tools: { grep: false } });
});

test('MCP servers come out of the config documents and the status list', () => {
  const read = readV2ToolConfig(config, agents, mcp);
  assert.deepStrictEqual(read.mcpConfig['sandbox-echo'], {
    type: 'local',
    enabled: true,
    command: ['node', '/sandbox/mcp/echo-mcp.mjs'],
    url: undefined,
    environment: { ECHO: '1' }
  });
  assert.strictEqual(read.mcpConfig.off?.enabled, false);
  assert.strictEqual(read.mcpConfig.remote?.url, 'https://mcp.example.test/mcp');
  assert.deepStrictEqual(read.mcpStatus, {
    'sandbox-echo': { status: 'connected' },
    off: { status: 'disabled' },
    broken: { status: undefined }
  });
});

test('nothing to read is an empty snapshot, not an error', () => {
  assert.deepStrictEqual(readV2ToolConfig(null, { data: [] }, undefined), { tools: {}, agents: {}, mcpConfig: {}, mcpStatus: {} });
});
