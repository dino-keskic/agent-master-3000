import React, { useMemo } from 'react';
import { AlertTriangle, RefreshCw, Wrench } from 'lucide-react';
import {
  McpServerInfo,
  SessionTool,
  SessionToolInventory,
  ToolStatusFilter,
  filterServers,
  filterTools,
  groupToolsBySource,
  pluginRule,
  pluginSections
} from '../../../shared/agent/tools';
import { Banner, Button, EmptyState } from '../ui';
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
  status: ToolStatusFilter;
  busy: boolean;
  /** A rule, not a tool: `name` for one, `server_*` for a whole server, `plugin:<id>` for a plugin. */
  onSave: (rule: string, enabled: boolean | null) => void;
  onRetry: () => void;
}

export const ToolsList: React.FC<ToolsListProps> = ({
  inventory,
  filter,
  status,
  busy,
  onSave,
  onRetry
}) => {
  const matching = useMemo(() => filterTools(inventory.tools, filter, status), [inventory.tools, filter, status]);
  const grouped = useMemo(() => groupToolsBySource(matching), [matching]);
  const serverInfo = useMemo(() => {
    const byName = new Map<string, McpServerInfo>();
    for (const server of inventory.servers) byName.set(server.name, server);
    return byName;
  }, [inventory.servers]);
  const plugins = useMemo(
    () => (status === 'all' ? pluginSections(inventory.plugins, grouped.byPlugin, filter) : {
      sections: grouped.byPlugin.map((g) => ({
        plugin: g.plugin ? inventory.plugins?.find((p) => p.id === g.plugin) : undefined,
        tools: g.tools
      })),
      quiet: []
    }),
    [inventory.plugins, grouped.byPlugin, filter, status]
  );
  const filtered = filter.trim() !== '' || status !== 'all';
  const emptyServers = filterServers(
    inventory.servers,
    grouped.byServer.map((group) => group.server),
    filter,
    status
  );

  const rowProps = {
    busy,
    onToggle: (tool: SessionTool, enabled: boolean) => onSave(tool.name, enabled),
    onClear: (tool: SessionTool) => onSave(tool.name, null)
  };

  return (
    <div className="flex flex-col p-3.5 pb-24">
      <p className="m-0 mb-3 px-0.5 text-[12px] leading-relaxed text-ink-3">
        What this session&apos;s agent can call, as OpenCode resolves it for{' '}
        <span className="font-mono text-ink-2">{inventory.cwd}</span>, grouped by where each tool
        comes from. A switch here applies to every session the board runs, and takes the tool — or
        the whole plugin — out of the agent&apos;s list rather than refusing it after the fact.
      </p>

      {inventory.error && (
        <Banner
          tone="err"
          icon={<AlertTriangle className="w-4 h-4" />}
          actions={
            <Button size="xs" variant="secondary" leftSection={<RefreshCw className="w-3 h-3" />} onClick={onRetry}>
              Retry
            </Button>
          }
          className="mb-3"
        >
          Could not read the tool list from OpenCode: {inventory.error}
        </Banner>
      )}
      {inventory.warnings.map((warning) => (
        <Banner key={warning} tone="wait" icon={<AlertTriangle className="w-3.5 h-3.5" />} className="mb-2.5">
          {warning}
        </Banner>
      ))}

      {grouped.builtin.length > 0 && <BuiltinGroup tools={grouped.builtin} filtered={filtered} {...rowProps} />}

      {plugins.sections.map((section) => (
        <PluginGroup
          key={section.plugin?.id ?? ''}
          plugin={section.plugin}
          tools={section.tools}
          filtered={filtered}
          switchable={!!inventory.pluginSwitches}
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

      {!inventory.error && matching.length === 0 && emptyServers.length === 0 && plugins.quiet.length === 0 && (
        <EmptyState
          icon={<Wrench className="w-4 h-4" />}
          title={
            filter.trim()
              ? 'No matching tools'
              : status === 'off'
                ? 'No disabled tools'
                : status === 'on'
                  ? 'No enabled tools'
                  : 'No tools reported'
          }
          description={
            filter.trim()
              ? `No tool matches "${filter}"${status !== 'all' ? ` (${status})` : ''}.`
              : status === 'off'
                ? 'Every tool in this session is currently enabled.'
                : status === 'on'
                  ? 'All tools in this session are switched off.'
                  : 'OpenCode reported no tools for this folder.'
          }
        />
      )}
    </div>
  );
};
