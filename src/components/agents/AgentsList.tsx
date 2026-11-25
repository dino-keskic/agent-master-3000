import React, { useMemo, useState } from 'react';
import { ScrollArea, Tooltip } from '@mantine/core';
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Folder,
  Globe,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Sparkles
} from 'lucide-react';
import { CustomAgent, filterCustomAgents, groupCustomAgents } from '../../../shared/agent/customAgents';
import { STUDIO_LIST_BOUNDS } from '../../../shared/board/panelResize';
import { shortModelLabel } from '../../../shared/format';
import { Button, Chip, SearchInput, SegmentedControl } from '../ui';

interface AgentsListProps {
  agents: CustomAgent[];
  selectedKey: string | null;
  creating: boolean;
  activeAgent?: string;
  filter: string;
  onFilterChange: (value: string) => void;
  onSelect: (key: string) => void;
  onCreate: () => void;
  onRefresh: () => void;
  fullWidth?: boolean;
  width?: number;
  onCollapse?: () => void;
}

type ScopeFilter = 'all' | 'project' | 'global';
type GroupKey = 'project' | 'global' | 'builtin';

export const AgentsList: React.FC<AgentsListProps> = ({
  agents,
  selectedKey,
  creating,
  activeAgent,
  filter,
  onFilterChange,
  onSelect,
  onCreate,
  onRefresh,
  fullWidth = false,
  width = STUDIO_LIST_BOUNDS.defaultSize,
  onCollapse
}) => {
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');
  const [collapsedGroups, setCollapsedGroups] = useState<Partial<Record<GroupKey, boolean>>>({});

  const toggleGroup = (group: GroupKey) => {
    setCollapsedGroups((prev) => ({ ...prev, [group]: !prev[group] }));
  };

  const filtered = useMemo(() => {
    const byText = filterCustomAgents(agents, filter);
    if (scopeFilter === 'project') return byText.filter((a) => a.scope === 'project');
    if (scopeFilter === 'global') return byText.filter((a) => a.scope === 'global');
    return byText;
  }, [agents, filter, scopeFilter]);

  const groups = useMemo(() => groupCustomAgents(filtered), [filtered]);
  const counts = useMemo(
    () => ({
      all: agents.length,
      project: agents.filter((a) => a.scope === 'project').length,
      global: agents.filter((a) => a.scope === 'global').length
    }),
    [agents]
  );

  const renderItem = (agent: CustomAgent) => {
    const isSelected = !creating && agent.key === selectedKey;
    const isCurrent = agent.id === activeAgent;
    const ruleCount = Object.keys(agent.resolvedTools || agent.tools).length;

    return (
      <button
        key={agent.key}
        type="button"
        onClick={() => onSelect(agent.key)}
        className={`w-full text-left rounded-xl p-2.5 transition-all duration-150 cursor-pointer border flex flex-col gap-1.5 ${
          isSelected
            ? 'bg-acc-bg border-acc-bd shadow-card'
            : 'bg-surface border-line hover:border-line-strong hover:bg-s3h'
        }`}
      >
        <div className="flex items-center justify-between gap-1.5 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                isCurrent ? 'bg-run' : isSelected ? 'bg-accent' : 'bg-ink-4/60'
              }`}
            />
            <span className="font-mono text-[12.5px] font-semibold text-ink truncate">
              {agent.name}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {isCurrent && <Chip tone="run">active</Chip>}
            {agent.mode && agent.mode !== 'all' && <Chip>{agent.mode}</Chip>}
          </div>
        </div>

        {agent.description ? (
          <p className="m-0 text-[11.5px] leading-[1.4] text-ink-3 line-clamp-2">
            {agent.description}
          </p>
        ) : (
          <p className="m-0 text-[11px] italic text-ink-4">
            {agent.sourceKind === 'builtin' ? 'Built-in OpenCode agent' : 'No description'}
          </p>
        )}

        <div className="flex items-center justify-between gap-2 pt-0.5 text-[10.5px] font-mono text-ink-4">
          <span className="truncate">{agent.model ? shortModelLabel(agent.model) : 'default model'}</span>
          {ruleCount > 0 && (
            <span className="shrink-0 text-acc-fg">
              {ruleCount} {ruleCount === 1 ? 'rule' : 'rules'}
            </span>
          )}
        </div>
      </button>
    );
  };

  const renderGroup = (
    key: GroupKey,
    label: string,
    icon: React.ReactNode,
    items: CustomAgent[]
  ) => {
    if (items.length === 0) return null;
    const collapsed = !!collapsedGroups[key];
    return (
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => toggleGroup(key)}
          aria-expanded={!collapsed}
          className="flex items-center justify-between w-full px-1 py-0.5 rounded-md hover:bg-s3h transition-colors cursor-pointer text-left"
        >
          <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wider text-ink-3 font-semibold">
            {collapsed ? (
              <ChevronRight className="w-3 h-3 text-ink-4 shrink-0" />
            ) : (
              <ChevronDown className="w-3 h-3 text-ink-4 shrink-0" />
            )}
            {icon}
            {label}
          </span>
          <span className="bubble is-muted">{items.length}</span>
        </button>
        {!collapsed && items.map(renderItem)}
      </div>
    );
  };

  return (
    <div
      style={fullWidth ? undefined : { width }}
      className={`${fullWidth ? 'flex-1' : 'shrink-0'} flex flex-col min-h-0 bg-surface/50`}
    >
      <div className="p-2.5 border-b border-line flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <SearchInput
            value={filter}
            onChange={onFilterChange}
            placeholder="Search agents…"
            containerClassName="flex-1 min-w-0"
          />
          <Tooltip label="Refresh agents" withArrow>
            <button type="button" className="icon-btn shrink-0" onClick={onRefresh} aria-label="Refresh agents">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <Button
            size="xs"
            variant="primary"
            onClick={onCreate}
            leftSection={<Plus className="w-3 h-3" />}
            className="shrink-0"
          >
            New
          </Button>
          {onCollapse && (
            <Tooltip label="Collapse agents list" withArrow>
              <button
                type="button"
                className="icon-btn shrink-0"
                onClick={onCollapse}
                aria-label="Collapse agents list"
              >
                <PanelLeftClose className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          )}
        </div>

        <SegmentedControl<ScopeFilter>
          size="xs"
          fullWidth
          value={scopeFilter}
          onChange={setScopeFilter}
          options={[
            { value: 'all', label: 'All', count: counts.all },
            { value: 'project', label: 'Project', count: counts.project },
            { value: 'global', label: 'Global', count: counts.global }
          ]}
        />
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2.5 flex flex-col gap-3">
          {creating && (
            <div className="rounded-xl p-2.5 border border-acc-bd bg-acc-bg flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-acc-fg shrink-0" />
              <span className="font-mono text-[12px] font-semibold text-acc-fg truncate">
                New custom agent…
              </span>
            </div>
          )}

          {renderGroup('project', 'Project', <Folder className="w-3 h-3" />, groups.project)}
          {renderGroup('global', 'Global', <Globe className="w-3 h-3" />, groups.global)}
          {renderGroup('builtin', 'Built-in', <Bot className="w-3 h-3" />, groups.builtin)}

          {filtered.length === 0 && !creating && (
            <div className="py-10 px-3 text-center flex flex-col items-center gap-2">
              <Bot className="w-6 h-6 text-ink-4" />
              <span className="text-[12px] text-ink-3">
                {filter.trim() ? 'No agents match your search.' : 'No custom agents in this scope yet.'}
              </span>
              {!filter.trim() && (
                <Button size="xs" variant="secondary" onClick={onCreate} leftSection={<Plus className="w-3 h-3" />}>
                  Create an agent
                </Button>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
