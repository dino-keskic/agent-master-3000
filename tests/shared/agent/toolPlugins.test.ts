import test from 'node:test';
import assert from 'node:assert';
import {
  SessionTool,
  SessionToolInventory,
  applyToolPolicyRule,
  boardConfigOverlay,
  groupToolsBySource,
  pluginOfRule,
  pluginRule,
  pluginSections
} from '../../../shared/agent/tools.js';
import { applyPluginRule } from '../../../shared/agent/toolPlugins.js';

const tool = (name: string, extra: Partial<SessionTool> = {}): SessionTool => ({
  name,
  source: 'plugin',
  enabled: true,
  used: 0,
  ...extra
});

test('a plugin switch is a policy key of its own', () => {
  assert.strictEqual(pluginRule('acme.demo'), 'plugin:acme.demo');
  assert.strictEqual(pluginOfRule('plugin:acme.demo'), 'acme.demo');
  assert.strictEqual(pluginOfRule('grep'), undefined);
});

test('a switched-off plugin becomes a -id entry, and never a tool key', () => {
  assert.deepStrictEqual(boardConfigOverlay({ grep: false, 'plugin:opencode.browser': false, 'plugin:b': true }), {
    tools: { grep: false },
    plugins: ['-opencode.browser']
  });
  assert.deepStrictEqual(boardConfigOverlay({ 'plugin:a': false }), { plugins: ['-a'] });
  assert.deepStrictEqual(boardConfigOverlay({}), {});
});

test('plugin tools are grouped by plugin, the unattributed last', () => {
  const grouped = groupToolsBySource([
    tool('plain'),
    tool('browser_back', { plugin: 'opencode.browser' }),
    tool('acme_greeting', { plugin: 'acme.demo' }),
    tool('read', { source: 'builtin' })
  ]);
  assert.deepStrictEqual(grouped.builtin.map((t) => t.name), ['read']);
  assert.deepStrictEqual(
    grouped.byPlugin.map((g) => [g.plugin, g.tools.map((t) => t.name)]),
    [
      ['acme.demo', ['acme_greeting']],
      ['opencode.browser', ['browser_back']],
      [undefined, ['plain']]
    ]
  );
});

test('switching a plugin off folds into its status and every tool it adds', () => {
  const inventory: SessionToolInventory = {
    cwd: '/w',
    tools: [tool('acme_greeting', { plugin: 'acme.demo' }), tool('grep', { source: 'builtin' })],
    servers: [],
    plugins: [{ id: 'acme.demo', builtin: false, status: 'active' }],
    warnings: [],
    policy: {},
    pendingRestart: false,
    generatedAt: 0
  };
  const off = applyToolPolicyRule(inventory, 'plugin:acme.demo', false, { 'plugin:acme.demo': false }, false);
  assert.strictEqual(off.plugins?.[0]?.status, 'off');
  assert.deepStrictEqual(
    off.tools.map((t) => [t.name, t.enabled, t.disabledBy]),
    [
      ['acme_greeting', false, 'plugin'],
      ['grep', true, undefined]
    ]
  );
  const on = applyToolPolicyRule(off, 'plugin:acme.demo', null, {}, false);
  assert.strictEqual(on.plugins?.[0]?.status, 'active');
  assert.strictEqual(on.tools[0]?.enabled, true);
});

test('plugin sections keep a plugin without tools, and filter by tool or id', () => {
  const plugins = [
    { id: 'acme.demo', builtin: false, status: 'active' as const },
    { id: 'hooks.only', builtin: false, status: 'active' as const }
  ];
  const byPlugin = [{ plugin: 'acme.demo', tools: [tool('acme_greeting')] }, { tools: [tool('plain')] }];
  assert.deepStrictEqual(
    pluginSections(plugins, byPlugin, '').sections.map((s) => [s.plugin?.id, s.tools.length]),
    [
      ['acme.demo', 1],
      ['hooks.only', 0],
      [undefined, 1]
    ]
  );
  assert.deepStrictEqual(
    pluginSections(plugins, byPlugin, 'hooks').sections.map((s) => s.plugin?.id),
    ['acme.demo', 'hooks.only', undefined]
  );
});

test("OpenCode's own plugins without tools fold into one list, unless failed or switched off", () => {
  const plugins = [
    { id: 'opencode.browser', builtin: true, status: 'active' as const },
    { id: 'opencode.lsp', builtin: true, status: 'active' as const },
    { id: 'opencode.share', builtin: true, status: 'off' as const },
    { id: 'opencode.tool.read', builtin: true, status: 'active' as const }
  ];
  const byPlugin = [{ plugin: 'opencode.browser', tools: [tool('browser_back')] }];
  const { sections, quiet } = pluginSections(plugins, byPlugin, '');
  assert.deepStrictEqual(sections.map((s) => s.plugin?.id), ['opencode.browser', 'opencode.share']);
  assert.deepStrictEqual(quiet.map((p) => p.id), ['opencode.lsp', 'opencode.tool.read']);
  assert.deepStrictEqual(pluginSections(plugins, byPlugin, 'lsp').quiet.map((p) => p.id), ['opencode.lsp']);
});

test("switching off an opencode.tool plugin takes its built-in tool with it", () => {
  const inventory = {
    cwd: '/w', tools: [{ ...tool('bash'), source: 'builtin' as const }], servers: [], warnings: [], policy: {},
    pendingRestart: false, generatedAt: 0,
    plugins: [{ id: 'opencode.tool.bash', builtin: true, status: 'active' as const }]
  };
  const off = applyPluginRule(inventory, 'opencode.tool.bash', false);
  assert.strictEqual(off.tools[0]?.enabled, false);
  assert.strictEqual(off.plugins?.[0]?.status, 'off');
  const on = applyPluginRule({ ...inventory, ...off }, 'opencode.tool.bash', null);
  assert.strictEqual(on.tools[0]?.enabled, true);
});
