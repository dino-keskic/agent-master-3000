import type { PluginInfo } from '../agent/toolPlugins.js';

/**
 * Where each of OpenCode 2's tools comes from: OpenCode itself, an MCP server,
 * or a plugin.
 *
 * 2.x has no endpoint listing tools, so the board loads a small plugin of its
 * own into the short-lived server it reads from (`PROBE_PLUGIN_SOURCE`), which
 * writes out `ctx.tool.list()`. That list names every tool and its namespace,
 * but not the plugin that added it — so this module works it out from what
 * OpenCode 2.0.24 does in the sandbox:
 *
 * - An MCP server's tools are namespaced by the server's name.
 * - OpenCode's own tools are either un-namespaced and backed by a built-in
 *   `opencode.tool.<name>` plugin, or in the `opencode` namespace.
 * - A plugin's tools are usually namespaced after it (`opencode.browser` adds
 *   `browser` and `browser.tabs`; `acme.demo` adds `acme`).
 * - A tool with no namespace and no built-in behind it came from a plugin the
 *   list does not name; with one plugin loaded from a file it is that one.
 *
 * What belongs here: reading the probe's and `/api/plugin`'s answers and
 * attributing tools. Starting the server is `server/toolCatalog/opencode.ts`.
 */

/** The probe's own id, so the panel never lists the board's plugin as the user's. */
export const PROBE_PLUGIN_ID = 'agent-master-3000.tool-probe';

/** The env var naming the file the probe writes to. */
export const PROBE_OUT_ENV = 'AGENT_MASTER_TOOL_PROBE_OUT';

/**
 * The probe itself. OpenCode 2 loads a configured plugin only from a
 * directory, so this is written as one with a `package.json` beside it. It
 * writes again every half second: MCP servers connect after the plugin's
 * setup has run, and the reader waits for a list that includes them.
 */
export const PROBE_PLUGIN_SOURCE = `import { writeFileSync } from "node:fs"
export default {
  id: ${JSON.stringify(PROBE_PLUGIN_ID)},
  async setup(ctx) {
    const out = process.env[${JSON.stringify(PROBE_OUT_ENV)}]
    if (!out) return
    const write = async () => {
      try {
        const tools = await ctx.tool.list()
        writeFileSync(out, JSON.stringify(tools.map((t) => ({
          id: t.id,
          namespace: t.options?.namespace,
          description: typeof t.description === "string" ? t.description.slice(0, 300) : undefined
        }))))
      } catch {}
    }
    await write()
    const timer = setInterval(write, 500)
    return () => clearInterval(timer)
  }
}
`;

export const PROBE_PLUGIN_PACKAGE = `${JSON.stringify(
  { name: 'agent-master-3000-tool-probe', private: true, type: 'module', main: 'index.mjs', exports: './index.mjs' },
  null,
  2
)}\n`;

export interface ProbedTool {
  id: string;
  namespace?: string;
  description?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The probe's file, or null when it is not there yet or was caught half-written. */
export function parseProbeOutput(text: string): ProbedTool[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  return parsed.map(asRecord).flatMap((entry) =>
    typeof entry.id === 'string' && entry.id
      ? [
          {
            id: entry.id,
            ...(typeof entry.namespace === 'string' && entry.namespace ? { namespace: entry.namespace } : {}),
            ...(typeof entry.description === 'string' && entry.description ? { description: entry.description } : {})
          }
        ]
      : []
  );
}

/** `/api/plugin`'s body, without the board's probe. */
export function parsePluginList(body: unknown): PluginInfo[] {
  const data = asRecord(body).data;
  if (!Array.isArray(data)) return [];
  return data.map(asRecord).flatMap((entry): PluginInfo[] => {
    if (typeof entry.id !== 'string' || entry.id === PROBE_PLUGIN_ID) return [];
    const source = asRecord(entry.source);
    const state = asRecord(entry.state);
    return [
      {
        id: entry.id,
        builtin: source.type === 'builtin',
        ...(typeof source.path === 'string' ? { path: source.path } : {}),
        status: state.status === 'failed' ? 'failed' : 'active',
        ...(typeof state.error === 'string' ? { error: state.error } : {})
      }
    ];
  });
}

export type ToolOrigin =
  | { kind: 'builtin' }
  | { kind: 'mcp'; server: string; toolName: string }
  /** `plugin` unset: a plugin added it, but which one cannot be told. */
  | { kind: 'plugin'; plugin?: string };

/**
 * OpenCode 1.x's own tools, as 1.18.32 lists them in the sandbox plus the ones
 * it adds behind a flag. 1.x's registry also holds the tools of plugins and of
 * `.opencode/tool/` files, and nothing there says which is which.
 */
export const V1_BUILTIN_TOOLS = new Set([
  'invalid', 'question', 'bash', 'read', 'glob', 'grep', 'edit', 'write', 'task', 'webfetch', 'todowrite',
  'todoread', 'websearch', 'codesearch', 'skill', 'apply_patch', 'patch', 'multiedit', 'list', 'lsp', 'batch',
  'plan_enter', 'plan_exit'
]);

/** OpenCode's own namespace, for the tools it adds about itself. */
const OPENCODE_NAMESPACE = 'opencode';

/** The plugin a namespace is named after, preferring the user's own over OpenCode's, then the shortest id. */
function pluginForNamespace(namespace: string, plugins: PluginInfo[]): string | undefined {
  const head = namespace.split('.')[0] ?? namespace;
  const candidates = plugins
    .filter((p) => !p.id.startsWith('opencode.tool.') && p.id.split('.').includes(head))
    .sort((a, b) => Number(a.builtin) - Number(b.builtin) || a.id.length - b.id.length);
  return candidates[0]?.id;
}

export function toolOrigin(tool: ProbedTool, plugins: PluginInfo[], mcpServers: string[]): ToolOrigin {
  const { id, namespace } = tool;
  if (namespace && mcpServers.includes(namespace) && id.startsWith(`${namespace}_`)) {
    return { kind: 'mcp', server: namespace, toolName: id.slice(namespace.length + 1) };
  }
  if (namespace === OPENCODE_NAMESPACE) return { kind: 'builtin' };
  if (!namespace && (plugins.length === 0 || plugins.some((p) => p.builtin && p.id === `opencode.tool.${id}`))) {
    // No plugin list at all: assume OpenCode's, as the panel did before it could tell.
    return { kind: 'builtin' };
  }
  if (namespace) {
    const plugin = pluginForNamespace(namespace, plugins);
    if (plugin) return { kind: 'plugin', plugin };
  }
  const local = plugins.filter((p) => !p.builtin);
  const only = local.length === 1 ? local[0] : undefined;
  return only ? { kind: 'plugin', plugin: only.id } : { kind: 'plugin' };
}

/**
 * The plugins worth a section: every one loaded from a file (it is the user's,
 * tools or not), every one that failed, every one the board switched off, and
 * the built-ins that add tools of their own (`opencode.browser`) — not the
 * eighty-odd that make up OpenCode itself.
 */
export function visiblePlugins(
  plugins: PluginInfo[],
  withTools: string[],
  switchedOff: string[]
): PluginInfo[] {
  const shown = plugins.filter(
    (p) => !p.builtin || p.status === 'failed' || withTools.includes(p.id) || switchedOff.includes(p.id)
  );
  // A switched-off plugin is not loaded, so OpenCode does not list it.
  for (const id of switchedOff) {
    if (!shown.some((p) => p.id === id)) shown.push({ id, builtin: id.startsWith('opencode.'), status: 'off' });
  }
  return shown
    .map((p) => (switchedOff.includes(p.id) ? { ...p, status: 'off' as const } : p))
    .sort((a, b) => a.id.localeCompare(b.id));
}
