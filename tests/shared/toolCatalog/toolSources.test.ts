import test from 'node:test';
import assert from 'node:assert';
import type { PluginInfo } from '../../../shared/agent/tools.js';
import {
  PROBE_PLUGIN_ID,
  PROBE_PLUGIN_SOURCE,
  parsePluginList,
  parseProbeOutput,
  pluginForFile,
  probeHasServers,
  switchedOffPlugins,
  toolOrigin,
  withSwitches
} from '../../../shared/toolCatalog/toolSources.js';

// What OpenCode 2.0.24 lists in the sandbox, trimmed.
const PLUGINS: PluginInfo[] = [
  { id: 'opencode.tool.read', builtin: true, status: 'active' },
  { id: 'opencode.tool.patch', builtin: true, status: 'active' },
  { id: 'opencode.tools', builtin: true, status: 'active' },
  { id: 'opencode.browser', builtin: true, status: 'active' },
  { id: 'acme.demo', builtin: false, path: '/w/.opencode/plugins/acme.ts', status: 'active' }
];
const SERVERS = ['sandbox-echo'];

test('the probe is a default export with the id the panel hides', () => {
  assert.match(PROBE_PLUGIN_SOURCE, /export default \{/);
  assert.ok(PROBE_PLUGIN_SOURCE.includes(JSON.stringify(PROBE_PLUGIN_ID)));
});

test('the probe output is read leniently, and a half-written file is not there yet', () => {
  assert.deepStrictEqual(
    parseProbeOutput('[{"id":"read","description":"Read a file"},{"id":"browser_back","namespace":"browser"},{"x":1}]'),
    [{ id: 'read', description: 'Read a file' }, { id: 'browser_back', namespace: 'browser' }]
  );
  assert.strictEqual(parseProbeOutput('[{"id":"re'), null);
  assert.strictEqual(parseProbeOutput('{}'), null);
});

test('the plugin list keeps id, source and failure, and drops the probe', () => {
  const body = {
    data: [
      { id: 'opencode.browser', source: { type: 'builtin' }, state: { status: 'active' } },
      { id: 'acme.demo', source: { type: 'local', path: '/w/acme.ts' }, state: { status: 'failed', error: 'boom' } },
      { id: PROBE_PLUGIN_ID, source: { type: 'local', path: '/data/tool-probe/plugin/index.mjs' }, state: { status: 'active' } }
    ]
  };
  assert.deepStrictEqual(parsePluginList(body), [
    { id: 'opencode.browser', builtin: true, status: 'active' },
    { id: 'acme.demo', builtin: false, path: '/w/acme.ts', status: 'failed', error: 'boom' }
  ]);
  assert.deepStrictEqual(parsePluginList(null), []);
});

test('an MCP tool belongs to the server its namespace names', () => {
  assert.deepStrictEqual(toolOrigin({ id: 'sandbox-echo_echo', namespace: 'sandbox-echo' }, PLUGINS, SERVERS), {
    kind: 'mcp',
    server: 'sandbox-echo',
    toolName: 'echo'
  });
});

test("OpenCode's own tools are built-ins, namespaced or not", () => {
  assert.deepStrictEqual(toolOrigin({ id: 'read' }, PLUGINS, SERVERS), { kind: 'builtin' });
  assert.deepStrictEqual(toolOrigin({ id: 'patch' }, PLUGINS, SERVERS), { kind: 'builtin' });
  assert.deepStrictEqual(toolOrigin({ id: 'opencode_models', namespace: 'opencode' }, PLUGINS, SERVERS), {
    kind: 'builtin'
  });
});

test('a namespaced tool belongs to the plugin named after it', () => {
  assert.deepStrictEqual(toolOrigin({ id: 'browser_tabs_list', namespace: 'browser.tabs' }, PLUGINS, SERVERS), {
    kind: 'plugin',
    plugin: 'opencode.browser'
  });
  assert.deepStrictEqual(toolOrigin({ id: 'acme_greeting', namespace: 'acme' }, PLUGINS, SERVERS), {
    kind: 'plugin',
    plugin: 'acme.demo'
  });
});

test('a bare tool with no built-in behind it is the one local plugin’s, else unattributed', () => {
  assert.deepStrictEqual(toolOrigin({ id: 'plain' }, PLUGINS, SERVERS), { kind: 'plugin', plugin: 'acme.demo' });
  const two = [...PLUGINS, { id: 'other.thing', builtin: false, status: 'active' as const }];
  assert.deepStrictEqual(toolOrigin({ id: 'plain' }, two, SERVERS), { kind: 'plugin' });
});

test('with no plugin list at all, a bare tool is assumed to be a built-in', () => {
  assert.deepStrictEqual(toolOrigin({ id: 'grep' }, [], SERVERS), { kind: 'builtin' });
});

test('a switched-off plugin is marked off, and one OpenCode no longer has is still listed', () => {
  const off = switchedOffPlugins({ 'plugin:opencode.browser': false, 'plugin:other.gone': false, 'plugin:acme.demo': true, grep: false });
  assert.deepStrictEqual([...off].sort(), ['opencode.browser', 'other.gone']);
  const shown = withSwitches(PLUGINS, off);
  assert.strictEqual(shown.length, PLUGINS.length + 1);
  assert.strictEqual(shown.find((p) => p.id === 'opencode.browser')?.status, 'off');
  assert.strictEqual(shown.find((p) => p.id === 'other.gone')?.status, 'off');
  assert.strictEqual(shown.find((p) => p.id === 'acme.demo')?.status, 'active');
});

test('a plugin that failed before it had an id is listed by its file name', () => {
  const body = {
    data: [
      { source: { type: 'local', path: '/h/.config/opencode/plugin/legacy.ts' }, state: { status: 'failed', error: 'no id' } },
      { source: { type: 'local', path: '/w/node_modules/legacy-pkg/index.js' }, state: { status: 'failed' } },
      { source: { type: 'local' }, state: { status: 'failed' } }
    ]
  };
  assert.deepStrictEqual(parsePluginList(body), [
    { id: 'legacy', builtin: false, path: '/h/.config/opencode/plugin/legacy.ts', status: 'failed', error: 'no id', anonymous: true },
    { id: 'legacy-pkg', builtin: false, path: '/w/node_modules/legacy-pkg/index.js', status: 'failed', anonymous: true }
  ]);
});

test('the probe output carries the file that registered a tool', () => {
  assert.deepStrictEqual(parseProbeOutput('[{"id":"zeta_ping","file":"/w/.opencode/plugins/zeta.ts"}]'), [
    { id: 'zeta_ping', file: '/w/.opencode/plugins/zeta.ts' }
  ]);
});

test('a file belongs to the plugin loaded from it, or whose package or folder holds it', () => {
  const plugins: PluginInfo[] = [
    { id: 'acme.demo', builtin: false, path: '/w/.opencode/plugins/acme.ts', status: 'active' },
    { id: 'zeta.tools', builtin: false, path: '/w/.opencode/plugins/zeta.ts', status: 'active' },
    { id: 'pkg.one', builtin: false, path: '/c/node_modules/@acme/one/dist/index.js', status: 'active' },
    { id: 'dir.plugin', builtin: false, path: '/p/my-plugin', status: 'active' }
  ];
  assert.strictEqual(pluginForFile('/w/.opencode/plugins/zeta.ts', plugins), 'zeta.tools');
  assert.strictEqual(pluginForFile('/c/node_modules/@acme/one/dist/tools/x.js', plugins), 'pkg.one');
  assert.strictEqual(pluginForFile('/p/my-plugin/src/tool.ts', plugins), 'dir.plugin');
  // A loose file owns only itself, not its neighbours.
  assert.strictEqual(pluginForFile('/w/.opencode/plugins/lib/helper.ts', plugins), undefined);
});

test('a tool traced to a plugin file belongs to it, whatever its namespace says', () => {
  const plugins: PluginInfo[] = [
    ...PLUGINS,
    { id: 'zeta.tools', builtin: false, path: '/w/.opencode/plugins/zeta.ts', status: 'active' }
  ];
  assert.deepStrictEqual(toolOrigin({ id: 'zeta_ping', file: '/w/.opencode/plugins/zeta.ts' }, plugins, SERVERS), {
    kind: 'plugin',
    plugin: 'zeta.tools'
  });
  // Two local plugins and no trace: no guess.
  assert.deepStrictEqual(toolOrigin({ id: 'plain' }, plugins, SERVERS), { kind: 'plugin' });
});

test('the probe records the registering file', () => {
  assert.match(PROBE_PLUGIN_SOURCE, /Map\.prototype\.set = function/);
  assert.match(PROBE_PLUGIN_SOURCE, /file: owners\.get\(t\.id\)/);
});

test('the probe list is complete once every connected MCP server has a tool in it', () => {
  const builtins = [{ id: 'read' }, { id: 'opencode_models', namespace: 'opencode' }];
  assert.strictEqual(probeHasServers(builtins, []), true);
  assert.strictEqual(probeHasServers(builtins, ['sandbox-echo']), false);
  const withEcho = [...builtins, { id: 'sandbox-echo_echo', namespace: 'sandbox-echo' }];
  assert.strictEqual(probeHasServers(withEcho, ['sandbox-echo']), true);
  assert.strictEqual(probeHasServers(withEcho, ['sandbox-echo', 'other']), false);
});
