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

/** An OpenCode 2 plugin that is not part of OpenCode's own tool set. */
export interface PluginInfo {
  id: string;
  /** Shipped inside OpenCode (`opencode.browser`) rather than loaded from a file. */
  builtin: boolean;
  /** Where a local plugin was loaded from. */
  path?: string;
  /** `off`: the board switched it off, so OpenCode never loaded it. */
  status: 'active' | 'failed' | 'off';
  error?: string;
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
      if (tool.plugin !== plugin) return tool;
      if (off) return { ...tool, enabled: false, disabledBy: 'plugin' as const, disabledByRule: pluginRule(plugin) };
      if (tool.disabledBy !== 'plugin') return tool;
      return { ...tool, enabled: true, disabledBy: undefined, disabledByRule: undefined };
    })
  };
}

/**
 * The panel's plugin sections: each plugin worth showing with the tools it
 * adds — including one that adds none, which is still the user's to switch off
 * — then any plugin tools the board could not pin on one plugin. A filter
 * keeps a plugin with a matching tool, or whose own id matches.
 */
export function pluginSections(
  plugins: PluginInfo[] | undefined,
  byPlugin: { plugin?: string; tools: SessionTool[] }[],
  filter: string
): { plugin?: PluginInfo; tools: SessionTool[] }[] {
  const needle = filter.trim().toLowerCase();
  const toolsOf = new Map(byPlugin.map((group) => [group.plugin ?? '', group.tools]));
  const sections: { plugin?: PluginInfo; tools: SessionTool[] }[] = [];
  const listed = new Set<string>();
  for (const plugin of plugins || []) {
    listed.add(plugin.id);
    const tools = toolsOf.get(plugin.id) || [];
    if (tools.length || !needle || plugin.id.toLowerCase().includes(needle)) sections.push({ plugin, tools });
  }
  for (const group of byPlugin) {
    if (group.plugin && !listed.has(group.plugin)) {
      sections.push({ plugin: { id: group.plugin, builtin: false, status: 'active' }, tools: group.tools });
    }
  }
  const unattributed = toolsOf.get('');
  if (unattributed?.length) sections.push({ tools: unattributed });
  return sections;
}
