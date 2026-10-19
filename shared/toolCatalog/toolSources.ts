import { type PluginInfo, pluginOfRule } from '../agent/toolPlugins.js';

/**
 * Where each of OpenCode 2's tools comes from: OpenCode itself, an MCP server,
 * or a plugin.
 *
 * 2.x has no endpoint listing tools, so the board loads a small plugin of its
 * own into the short-lived server it reads from (`PROBE_PLUGIN_SOURCE`), which
 * writes out `ctx.tool.list()`. That list names every tool and its namespace,
 * but not the plugin that added it. So the probe also watches every tool being
 * registered and notes the first file on the stack that is not OpenCode's own
 * — the plugin's source file. From there, what OpenCode 2.0.24 does in the
 * sandbox fills in the rest:
 *
 * - A tool registered from a plugin's file is that plugin's.
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
 * writes again every quarter second: MCP servers connect after the plugin's
 * setup has run, and the reader waits for a list that includes them.
 *
 * Which plugin added a tool: OpenCode keeps its tools in a Map keyed by id,
 * and re-runs every plugin's tool transform whenever the list changes, so
 * patching `Map.prototype.set` sees each registration with the registering
 * plugin's frame on the stack. Frames inside OpenCode's binary (`$bunfs`,
 * `~BUN`) and the probe's own are skipped; the first left is the plugin's.
 * This only lives in the panel's short-lived server, never the agent's.
 */
export const PROBE_PLUGIN_SOURCE = `import { writeFileSync } from "node:fs"
const plain = (path) => { try { return decodeURI(path) } catch { return path } }
const self = plain(new URL(import.meta.url).pathname.replace(/[^/]*$/, ""))
const owners = new Map()
const frameFile = (line) => {
  const m = /(?:\\(|^at )((?:file:\\/\\/)?(?:[A-Za-z]:)?[\\\\/].*):\\d+:\\d+\\)?$/.exec(line.trim())
  return m ? plain(m[1].replace(/^file:\\/\\//, "")) : undefined
}
const set = Map.prototype.set
Map.prototype.set = function (key, value) {
  if (typeof key === "string" && value && typeof value === "object" && value.id === key &&
      typeof value.execute === "function" && !owners.has(key)) {
    for (const line of (new Error().stack || "").split("\\n").slice(1)) {
      if (line.includes("$bunfs") || line.includes("~BUN") || line.includes(self)) continue
      const file = frameFile(line)
      if (file) { set.call(owners, key, file); break }
    }
  }
  return set.call(this, key, value)
}
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
          description: typeof t.description === "string" ? t.description.slice(0, 300) : undefined,
          file: owners.get(t.id)
        }))))
      } catch {}
    }
    await write()
    const timer = setInterval(write, 250)
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
  /** The source file that registered it, when that was not inside OpenCode. */
  file?: string;
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
            ...(typeof entry.description === 'string' && entry.description ? { description: entry.description } : {}),
            ...(typeof entry.file === 'string' && entry.file ? { file: entry.file } : {})
          }
        ]
      : []
  );
}

/**
 * A plugin OpenCode could not even name: a 1.x-style file with no default
 * `{ id, setup }` fails before it has an id. It is called after its file — the
 * folder's name when the file is an `index` — so it can still be listed.
 */
function nameFromPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  const file = (parts.pop() || path).replace(/\.[^.]+$/, '');
  return file === 'index' && parts.length ? parts[parts.length - 1]! : file;
}

/** `/api/plugin`'s body, without the board's probe. */
export function parsePluginList(body: unknown): PluginInfo[] {
  const data = asRecord(body).data;
  if (!Array.isArray(data)) return [];
  return data.map(asRecord).flatMap((entry): PluginInfo[] => {
    if (entry.id === PROBE_PLUGIN_ID) return [];
    const source = asRecord(entry.source);
    const state = asRecord(entry.state);
    const path = typeof source.path === 'string' && source.path ? source.path : undefined;
    const named = typeof entry.id === 'string' && entry.id !== '';
    if (!named && !path) return [];
    return [
      {
        id: named ? (entry.id as string) : nameFromPath(path!),
        builtin: source.type === 'builtin',
        ...(path ? { path } : {}),
        status: state.status === 'failed' ? 'failed' : 'active',
        ...(typeof state.error === 'string' ? { error: state.error } : {}),
        ...(named ? {} : { anonymous: true })
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

/** A package's folder, for a path inside `node_modules`: everything in it is that package's. */
function packageRoot(path: string): string | undefined {
  const m = /^(.*[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)(?:[\\/]|$)/.exec(path);
  return m?.[1];
}

/** True when `path` names a folder rather than a file — no extension on its last part. */
function looksLikeFolder(path: string): boolean {
  return !/\.[^.\\/]+$/.test(path);
}

/**
 * The plugin whose code `file` is: the one loaded from exactly that file, else
 * the one whose package or folder holds it (the deepest, when several do). A
 * plugin loaded from a loose file owns only that file — its neighbours in
 * `.opencode/plugins/` are other plugins.
 */
export function pluginForFile(file: string, plugins: PluginInfo[]): string | undefined {
  const exact = plugins.find((p) => p.path === file);
  if (exact) return exact.id;
  let best: { id: string; length: number } | undefined;
  for (const plugin of plugins) {
    if (!plugin.path) continue;
    const root = packageRoot(plugin.path) ?? (looksLikeFolder(plugin.path) ? plugin.path.replace(/[\\/]+$/, '') : undefined);
    if (!root || !(file.startsWith(`${root}/`) || file.startsWith(`${root}\\`))) continue;
    if (!best || root.length > best.length) best = { id: plugin.id, length: root.length };
  }
  return best?.id;
}

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
  // Seen being registered from a plugin's own file: nothing to guess.
  const owner = tool.file ? pluginForFile(tool.file, plugins) : undefined;
  if (owner) return { kind: 'plugin', plugin: owner };
  if (namespace === OPENCODE_NAMESPACE) return { kind: 'builtin' };
  if (!namespace && (plugins.length === 0 || plugins.some((p) => p.builtin && p.id === `opencode.tool.${id}`))) {
    // No plugin list at all: assume OpenCode's, as the panel did before it could tell.
    return { kind: 'builtin' };
  }
  if (namespace) {
    const plugin = pluginForNamespace(namespace, plugins);
    if (plugin) return { kind: 'plugin', plugin };
  }
  const local = plugins.filter((p) => !p.builtin && p.status !== 'failed');
  const only = local.length === 1 ? local[0] : undefined;
  return only ? { kind: 'plugin', plugin: only.id } : { kind: 'plugin' };
}

/** The plugins the board's policy switches off (`plugin:<id>` set to false). */
export function switchedOffPlugins(policy: Record<string, boolean>): Set<string> {
  const off = new Set<string>();
  for (const [rule, on] of Object.entries(policy)) {
    const plugin = pluginOfRule(rule);
    if (plugin !== undefined && !on) off.add(plugin);
  }
  return off;
}

/**
 * Every plugin, with the board's switches folded in, sorted by id. The panel's
 * server loads all of them whatever the switches say, so the list is whole and
 * does not change with a switch; a plugin switched off that OpenCode no longer
 * has at all is still listed, so it can be switched back.
 */
export function withSwitches(plugins: PluginInfo[], off: Set<string>): PluginInfo[] {
  const all = plugins.map((p) => (off.has(p.id) && !p.anonymous ? { ...p, status: 'off' as const } : p));
  for (const id of off) {
    if (!all.some((p) => p.id === id)) all.push({ id, builtin: id.startsWith('opencode.'), status: 'off' });
  }
  return all.sort((a, b) => a.id.localeCompare(b.id));
}
