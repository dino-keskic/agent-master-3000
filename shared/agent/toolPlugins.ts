import type { SessionTool, SessionToolInventory } from './tools.js';

/**
 * OpenCode 2 plugins as the Tools panel sees them: what one is, and the switch
 * that turns a whole plugin off.
 *
 * A plugin switch is a key in the board's tool policy (`plugin:<id>`), so it
 * is stored, signed and delivered like every other switch; `boardConfigOverlay`
 * in `tools.ts` turns it into OpenCode's `-id` entry. Which plugin a tool
 * came from is `shared/toolCatalog/toolSources.ts`.
 */

/** An OpenCode 2 plugin, OpenCode's own included. */
export interface PluginInfo {
  id: string;
  /** Shipped inside OpenCode (`opencode.browser`) rather than loaded from a file. */
  builtin: boolean;
  /** Where a local plugin was loaded from. */
  path?: string;
  /** `off`: the board switched it off, so OpenCode never loaded it. */
  status: 'active' | 'failed' | 'off';
  error?: string;
  /**
   * Failed before it had an id (a 1.x-style file), so `id` is its file's name
   * and there is nothing to switch off: OpenCode matches `-id` by id.
   */
  anonymous?: boolean;
}

/**
 * A policy key that switches a whole OpenCode 2 plugin rather than a tool —
 * kept in the same map so it is stored, signed and applied like any switch.
 */
export const PLUGIN_RULE_PREFIX = 'plugin:';

export function pluginRule(id: string): string {
  return `${PLUGIN_RULE_PREFIX}${id}`;
}

/** The plugin a policy key names, or undefined for a tool rule. */
export function pluginOfRule(rule: string): string | undefined {
  return rule.startsWith(PLUGIN_RULE_PREFIX) ? rule.slice(PLUGIN_RULE_PREFIX.length) : undefined;
}

/**
 * Whether `plugin` is where `tool` comes from: the plugin it was traced to, or
 * — for one of OpenCode's own tools — the built-in `opencode.tool.<name>`
 * plugin that each of them is.
 */
export function pluginAdds(plugin: string, tool: SessionTool): boolean {
  return tool.plugin === plugin || (tool.source === 'builtin' && plugin === `opencode.tool.${tool.name}`);
}

/**
 * Fold a saved plugin switch into an inventory: the plugin's own status, and
 * every tool it adds. Turning one back on cannot say what the config below
 * decides for its tools, so they read as available until the next read.
 */
export function applyPluginRule(
  inventory: SessionToolInventory,
  plugin: string,
  enabled: boolean | null
): Pick<SessionToolInventory, 'plugins' | 'tools'> {
  const off = enabled === false;
  return {
    plugins: inventory.plugins?.map((info) =>
      info.id !== plugin ? info : { ...info, status: off ? 'off' : info.status === 'off' ? 'active' : info.status }
    ),
    tools: inventory.tools.map((tool) => {
      if (!pluginAdds(plugin, tool)) return tool;
      if (off) return { ...tool, enabled: false, disabledBy: 'plugin' as const, disabledByRule: pluginRule(plugin) };
      if (tool.disabledBy !== 'plugin') return tool;
      return { ...tool, enabled: true, disabledBy: undefined, disabledByRule: undefined };
    })
  };
}

/**
 * Whether a plugin gets a section of its own: every one loaded from a file
 * (it is the user's, tools or not), every one that failed or is switched off,
 * and OpenCode's own that add tools of their own (`opencode.browser`). The
 * eighty-odd others that make up OpenCode itself go in one folded list.
 */
function ownsSection(plugin: PluginInfo, tools: number): boolean {
  return !plugin.builtin || plugin.status !== 'active' || tools > 0;
}

export interface PluginSections {
  sections: { plugin?: PluginInfo; tools: SessionTool[] }[];
  /** OpenCode's own plugins with no tools to show, each still switchable. */
  quiet: PluginInfo[];
}

/**
 * The panel's plugin sections: each plugin worth showing with the tools it
 * adds — including one that adds none, which is still the user's to switch off
 * — then any plugin tools the board could not pin on one plugin, and the rest
 * of OpenCode's own plugins. A filter keeps a plugin with a matching tool, or
 * whose own id matches.
 */
export function pluginSections(
  plugins: PluginInfo[] | undefined,
  byPlugin: { plugin?: string; tools: SessionTool[] }[],
  filter: string
): PluginSections {
  const needle = filter.trim().toLowerCase();
  const toolsOf = new Map(byPlugin.map((group) => [group.plugin ?? '', group.tools]));
  const sections: PluginSections['sections'] = [];
  const quiet: PluginInfo[] = [];
  const listed = new Set<string>();
  for (const plugin of plugins || []) {
    listed.add(plugin.id);
    const tools = toolsOf.get(plugin.id) || [];
    const matches = !needle || plugin.id.toLowerCase().includes(needle);
    if (!ownsSection(plugin, tools.length)) {
      if (matches) quiet.push(plugin);
    } else if (tools.length || matches) {
      sections.push({ plugin, tools });
    }
  }
  for (const group of byPlugin) {
    if (group.plugin && !listed.has(group.plugin)) {
      sections.push({ plugin: { id: group.plugin, builtin: false, status: 'active' }, tools: group.tools });
    }
  }
  const unattributed = toolsOf.get('');
  if (unattributed?.length) sections.push({ tools: unattributed });
  return { sections, quiet };
}
