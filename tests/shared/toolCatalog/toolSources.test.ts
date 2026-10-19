import test from 'node:test';
import assert from 'node:assert';
import type { PluginInfo } from '../../../shared/agent/tools.js';
import {
  PROBE_PLUGIN_ID,
  PROBE_PLUGIN_SOURCE,
  parsePluginList,
  parseProbeOutput,
  toolOrigin,
  visiblePlugins
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

test('only the plugins worth a section are shown, and a switched-off one stays', () => {
  const shown = visiblePlugins(PLUGINS, ['opencode.browser'], ['other.gone']);
  assert.deepStrictEqual(
    shown.map((p) => [p.id, p.status]),
    [
      ['acme.demo', 'active'],
      ['opencode.browser', 'active'],
      ['other.gone', 'off']
    ]
  );
  assert.deepStrictEqual(
    visiblePlugins(PLUGINS, [], ['opencode.browser']).find((p) => p.id === 'opencode.browser')?.status,
    'off'
  );
});
