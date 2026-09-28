import React, { useMemo } from 'react';
import { Stack, Text } from '@mantine/core';
import {
  McpServerInfo,
  SessionTool,
  SessionToolInventory,
  filterServers,
  filterTools,
  groupToolsBySource
} from '../../../shared/agent/tools';
import { BuiltinGroup, EmptyServerGroup, ServerGroup } from './ToolGroup';

/**
 * The tools themselves, in the groups they come from: OpenCode's own first,
 * then one group per MCP server — including the servers that contributed
 * nothing, because "this server is down" is what the panel is for.
 */

interface ToolsListProps {
  inventory: SessionToolInventory;
  filter: string;
  busy: boolean;
  /** A rule, not a tool: `name` for one, `server_*` for a whole server. */
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
        <span className="font-mono text-ink-2">{inventory.cwd}</span>. MCP tools carry the
        name the model sees them by. A switch here applies to every session the board runs, and
        takes the tool out of the agent&apos;s list rather than refusing it after the fact.
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

      {grouped.builtin.length > 0 && <BuiltinGroup tools={grouped.builtin} {...rowProps} />}

      {grouped.byServer.map((group) => (
        <ServerGroup
          key={group.server}
          server={group.server}
          source={group.source}
          tools={group.tools}
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
