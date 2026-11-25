import React, { useMemo, useState } from 'react';
import { Loader, ScrollArea, Tooltip } from '@mantine/core';
import { AlertTriangle, Plus, RotateCcw, Shield, Wrench } from 'lucide-react';
import { CustomAgent, resolveAgentToolInventory } from '../../../shared/agent/customAgents';
import {
  McpServerInfo,
  SessionTool,
  SessionToolInventory,
  filterServers,
  filterTools,
  groupToolsBySource,
  pluginSections,
  resolveToolState
} from '../../../shared/agent/tools';
import { V1_BUILTIN_TOOLS } from '../../../shared/toolCatalog/toolSources';
import { BuiltinGroup, EmptyServerGroup, PluginGroup, ServerGroup } from '../tools/ToolGroup';
import { Banner, Button, Chip, EmptyState, PaneToolbar, SearchInput, SegmentedControl } from '../ui';

/**
 * Per-agent tool switches: enables or disables individual built-in, plugin,
 * MCP, board tools, or custom glob rules specifically for the selected agent.
 *
 * When OpenCode's live tool catalog cannot be probed (e.g. OpenCode is not
 * configured or exited), falls back to OpenCode's standard built-in tool list
 * plus any rules already declared on this agent so toggling still works.
 */

interface AgentToolsEditorProps {
  agent: Pick<CustomAgent, 'id' | 'tools' | 'resolvedTools' | 'sourceKind'>;
  toolInventory: SessionToolInventory | null;
  agentToolPolicy?: Record<string, boolean>;
  toolsLoading: boolean;
  busy: boolean;
  onToggleRule: (rule: string, enabled: boolean | null) => void;
  onResetAll?: () => void;
}

type StatusFilter = 'all' | 'on' | 'off';

function fallbackInventory(
  agent: Pick<CustomAgent, 'id' | 'tools' | 'resolvedTools' | 'sourceKind'>,
  agentToolPolicy?: Record<string, boolean>,
  catalogError?: string
): SessionToolInventory {
  const agentTools =
    agent.sourceKind === 'markdown'
      ? agent.tools
      : { ...(agent.resolvedTools || agent.tools), ...(agentToolPolicy || {}) };

  const names = new Set<string>([...V1_BUILTIN_TOOLS]);
  for (const rule of Object.keys(agentTools)) {
    if (!rule.includes('*')) names.add(rule);
  }

  const tools: SessionTool[] = [...names].sort().map((name) => ({
    name,
    source: 'builtin',
    ...resolveToolState(name, { agentTools }),
    used: 0
  }));

  return {
    cwd: '',
    agent: agent.id,
    tools,
    servers: [],
    warnings: [],
    policy: {},
    pendingRestart: false,
    generatedAt: Date.now(),
    ...(catalogError ? { error: catalogError } : {})
  };
}

export const AgentToolsEditor: React.FC<AgentToolsEditorProps> = ({
  agent,
  toolInventory,
  agentToolPolicy,
  toolsLoading,
  busy,
  onToggleRule,
  onResetAll
}) => {
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [customRule, setCustomRule] = useState('');

  const resolved = useMemo(() => {
    if (toolInventory && !toolInventory.error && toolInventory.tools.length > 0) {
      return resolveAgentToolInventory(toolInventory, agent, agentToolPolicy);
    }
    return fallbackInventory(agent, agentToolPolicy, toolInventory?.error);
  }, [toolInventory, agent, agentToolPolicy]);

  const isFallback = !toolInventory || !!toolInventory.error || toolInventory.tools.length === 0;

  const matching = useMemo(() => {
    const byText = filterTools(resolved.tools, filter);
    if (statusFilter === 'on') return byText.filter((t) => t.enabled);
    if (statusFilter === 'off') return byText.filter((t) => !t.enabled);
    return byText;
  }, [resolved.tools, filter, statusFilter]);

  const grouped = useMemo(() => groupToolsBySource(matching), [matching]);
  const serverInfo = useMemo(() => {
    const byName = new Map<string, McpServerInfo>();
    for (const server of resolved.servers) byName.set(server.name, server);
    return byName;
  }, [resolved.servers]);

  const plugins = useMemo(
    () => pluginSections(resolved.plugins, grouped.byPlugin, filter),
    [resolved.plugins, grouped.byPlugin, filter]
  );

  const filtered = filter.trim() !== '' || statusFilter !== 'all';
  const emptyServers =
    statusFilter === 'all'
      ? filterServers(
          resolved.servers,
          grouped.byServer.map((group) => group.server),
          filter
        )
      : [];

  const totalCount = resolved.tools.length;
  const enabledCount = resolved.tools.filter((t) => t.enabled).length;
  const offCount = totalCount - enabledCount;
  const isAllowList = agent.tools['*'] === false;
  const activeMap =
    agent.sourceKind === 'markdown'
      ? agent.tools
      : { ...(agent.resolvedTools || {}), ...(agentToolPolicy || {}) };
  const ruleEntries = Object.entries(activeMap);
  const hasRules = Object.keys(agent.tools).length > 0 || Object.keys(agentToolPolicy || {}).length > 0;

  const addCustomRule = (enabled: boolean) => {
    const trimmed = customRule.trim();
    if (!trimmed) return;
    onToggleRule(trimmed, enabled);
    setCustomRule('');
  };

  if (toolsLoading && !toolInventory) {
    return (
      <div className="flex items-center justify-center py-12 gap-2">
        <Loader size="sm" color="gray" />
        <span className="text-[12px] text-ink-3 font-mono">Loading agent tool catalog…</span>
      </div>
    );
  }

  const rowProps = {
    busy,
    onToggle: (tool: SessionTool, enabled: boolean) => onToggleRule(tool.name, enabled),
    onClear: (tool: SessionTool) => onToggleRule(tool.name, null)
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <PaneToolbar
        left={
          <div className="flex items-center gap-2 flex-wrap">
            <SearchInput
              value={filter}
              onChange={setFilter}
              placeholder="Filter agent tools…"
              containerClassName="w-52 max-w-full"
            />
            <SegmentedControl<StatusFilter>
              size="xs"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: 'all', label: 'All', count: totalCount },
                { value: 'on', label: 'On', count: enabledCount },
                { value: 'off', label: 'Off', count: offCount }
              ]}
            />
          </div>
        }
        right={
          <div className="flex items-center gap-1.5">
            {agent.sourceKind === 'markdown' && (
              <Tooltip
                label={
                  isAllowList
                    ? 'Currently deny-by-default (*: false). Click to allow tools by default.'
                    : 'Switch to allow-list mode (*: false) so only checked tools are enabled'
                }
                withArrow
              >
                <Button
                  size="xs"
                  variant={isAllowList ? 'primary' : 'secondary'}
                  disabled={busy}
                  leftSection={<Shield className="w-3 h-3" />}
                  onClick={() => onToggleRule('*', isAllowList ? null : false)}
                >
                  {isAllowList ? 'Allow-list mode' : 'Allow-list'}
                </Button>
              </Tooltip>
            )}
            {hasRules && onResetAll && (
              <Tooltip label="Clear all tool overrides for this agent" withArrow>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy}
                  leftSection={<RotateCcw className="w-3 h-3" />}
                  onClick={onResetAll}
                >
                  Reset
                </Button>
              </Tooltip>
            )}
          </div>
        }
      />

      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col p-4 pb-16 max-w-4xl mx-auto">
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[12px] text-ink-3">
                {agent.sourceKind === 'markdown'
                  ? 'Switches update this agent’s markdown frontmatter.'
                  : 'Switches save a board override specifically for this agent.'}
              </span>
              {isAllowList && (
                <Chip tone="accent" className="font-mono">
                  *: false (allow-list)
                </Chip>
              )}
            </div>

            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                addCustomRule(false);
              }}
            >
              <input
                type="text"
                value={customRule}
                onChange={(e) => setCustomRule(e.currentTarget.value)}
                placeholder="Rule pattern (e.g. github_*)"
                spellCheck={false}
                className="h-7 w-56 px-2.5 rounded-lg border border-line bg-surface font-mono text-[11.5px] text-ink placeholder:text-ink-4 focus:outline-none focus:border-acc-bd"
              />
              <Button
                type="submit"
                size="xs"
                variant="secondary"
                disabled={!customRule.trim() || busy}
                leftSection={<Plus className="w-3 h-3" />}
              >
                Disable rule
              </Button>
              <Button
                type="button"
                size="xs"
                variant="secondary"
                disabled={!customRule.trim() || busy}
                onClick={() => addCustomRule(true)}
              >
                Enable rule
              </Button>
            </form>
          </div>

          {ruleEntries.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap mb-3 px-0.5">
              <span className="font-mono text-[10.5px] uppercase tracking-wider text-ink-4">
                Active rules:
              </span>
              {ruleEntries.map(([rule, enabled]) => (
                <Chip
                  key={rule}
                  as="button"
                  tone={enabled ? 'run' : 'err'}
                  onClick={() => onToggleRule(rule, null)}
                  title="Click to remove rule"
                  className="font-mono cursor-pointer hover:opacity-80"
                >
                  {rule}: {enabled ? 'on' : 'off'} ×
                </Chip>
              ))}
            </div>
          )}

          {isFallback && (
            <Banner tone="wait" icon={<AlertTriangle className="w-3.5 h-3.5" />} className="mb-3">
              Live OpenCode tool catalog unavailable ({resolved.error || 'not connected'}). Showing standard
              built-in tools and any custom rules — switches still save to this agent.
            </Banner>
          )}

          {grouped.builtin.length > 0 && <BuiltinGroup tools={grouped.builtin} filtered={filtered} {...rowProps} />}

          {plugins.sections.map((section) => (
            <PluginGroup
              key={section.plugin?.id ?? ''}
              plugin={section.plugin}
              tools={section.tools}
              filtered={filtered}
              switchable={false}
              onTogglePlugin={() => {}}
              {...rowProps}
            />
          ))}

          {grouped.byServer.map((group) => (
            <ServerGroup
              key={group.server}
              server={group.server}
              source={group.source}
              tools={group.tools}
              filtered={filtered}
              info={serverInfo.get(group.server)}
              onToggleAll={(enabled) => onToggleRule(`${group.server}_*`, enabled)}
              {...rowProps}
            />
          ))}

          {emptyServers.map((server) => (
            <EmptyServerGroup key={server.name} server={server} />
          ))}

          {matching.length === 0 && (
            <EmptyState
              icon={<Wrench className="w-4 h-4" />}
              title={filter.trim() || statusFilter !== 'all' ? 'No matching tools' : 'No tools reported'}
              description="Adjust your filter or add a rule pattern above."
            />
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
