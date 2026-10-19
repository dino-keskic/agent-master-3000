import React, { useMemo } from 'react';
import { Stack, Text } from '@mantine/core';
import {
  McpServerInfo,
  SessionTool,
  SessionToolInventory,
  filterServers,
  filterTools,
  groupToolsBySource,
  pluginRule,
  pluginSections
} from '../../../shared/agent/tools';
import { BuiltinGroup, EmptyServerGroup, PluginGroup, QuietPluginsGroup, ServerGroup } from './ToolGroup';

/**
 * The tools themselves, in the groups they come from: OpenCode's own first,
 * then one group per plugin, the rest of OpenCode's plugins folded into one
 * list, and one group per MCP server — including the servers
 * that contributed nothing, because "this server is down" is what the panel
 * is for.
 */

interface ToolsListProps {
  inventory: SessionToolInventory;
  filter: string;
  busy: boolean;
  /** A rule, not a tool: `name` for one, `server_*` for a whole server, `plugin:<id>` for a plugin. */
  onSave: (rule: string, enabled: boolean | null) => void;
}

export const ToolsList: React.FC<ToolsListProps> = ({ inventory, filter, busy, onSave }) => {
  const matching = useMemo(() => filterTools(inventory.tools, filter), [inventory.tools, filter]);
  const grouped = useMemo(() => groupToolsBySource(matching), [matching]);
  const serverInfo = useMemo(() => {
    const byName = new Map<string, McpServerInfo>();
    for (const server of inventory.servers) byName.set(server.name, server);
    return byName;
  }, [inventory.servers]);
  const plugins = useMemo(
    () => pluginSections(inventory.plugins, grouped.byPlugin, filter),
    [inventory.plugins, grouped.byPlugin, filter]
  );
  const filtered = filter.trim() !== '';
  const emptyServers = filterServers(
    inventory.servers,
    grouped.byServer.map((group) => group.server),
    filter
  );

  const rowProps = {
    busy,
    onToggle: (tool: SessionTool, enabled: boolean) => onSave(tool.name, enabled),
    onClear: (tool: SessionTool) => onSave(tool.name, null)
  };

  return (
    <Stack gap={0} p="xs" className="pb-24">
      <Text size="xs" c="dimmed" px="xs" pb="xs">
        What this session&apos;s agent can call, as OpenCode resolves it for{' '}
        <span className="font-mono text-ink-2">{inventory.cwd}</span>, grouped by where each tool
        comes from. MCP tools carry the name the model sees them by. A switch here applies to every
        session the board runs, and takes the tool — or the whole plugin — out of the agent&apos;s
        list rather than refusing it after the fact.
      </Text>

      {inventory.error && (
        <Text size="sm" c="dimmed" ta="center" py="xl">
          Could not read the tool list from OpenCode: {inventory.error}
        </Text>
      )}
      {inventory.warnings.map((warning) => (
        <Text key={warning} size="xs" c="yellow" px="xs" pb="xs">
          {warning}
        </Text>
      ))}

      {grouped.builtin.length > 0 && <BuiltinGroup tools={grouped.builtin} filtered={filtered} {...rowProps} />}

      {plugins.sections.map((section) => (
        <PluginGroup
          key={section.plugin?.id ?? ''}
          plugin={section.plugin}
          tools={section.tools}
          filtered={filtered}
          switchable={!!inventory.pluginSwitches}
          // On is dropping the board's entry: it can only stop a plugin loading, never add one.
          onTogglePlugin={(enabled) => section.plugin && onSave(pluginRule(section.plugin.id), enabled ? null : false)}
          {...rowProps}
        />
      ))}

      {plugins.quiet.length > 0 && (
        <QuietPluginsGroup
          plugins={plugins.quiet}
          filtered={filtered}
          busy={busy}
          onTogglePlugin={(id, enabled) => onSave(pluginRule(id), enabled ? null : false)}
        />
      )}

      {grouped.byServer.map((group) => (
        <ServerGroup
          key={group.server}
          server={group.server}
          source={group.source}
          tools={group.tools}
          filtered={filtered}
          info={serverInfo.get(group.server)}
          onToggleAll={(enabled) => onSave(`${group.server}_*`, enabled)}
          {...rowProps}
        />
      ))}

      {emptyServers.map((server) => (
        <EmptyServerGroup key={server.name} server={server} />
      ))}

      {!inventory.error && matching.length === 0 && (
        <Text size="sm" c="dimmed" ta="center" py="xl">
          {filter.trim() ? 'No tool matches that filter.' : 'OpenCode reported no tools for this folder.'}
        </Text>
      )}
    </Stack>
  );
};
