import React, { useState } from 'react';
import { Switch, Tooltip } from '@mantine/core';
import { ChevronDown, ChevronRight, ClipboardList, Puzzle, Server, Wrench } from 'lucide-react';
import { McpServerInfo, McpServerStatus, PluginInfo, SessionTool, ToolSource } from '../../../shared/agent/tools';
import { Chip, ChipTone, Surface } from '../ui';
import { ToolRow } from './ToolRow';

/**
 * A boxed section of the panel: built-ins, one MCP server, or one plugin, and
 * its tools.
 *
 * A server with nothing to list still gets a box. An empty Slack section is the
 * answer to "why is the agent not using it", and leaving it out would read as
 * the server not being configured at all.
 */

const STATUS_LABEL: Record<McpServerStatus, string> = {
  connected: 'connected',
  disabled: 'disabled',
  failed: 'failed',
  needs_auth: 'needs auth',
  unknown: 'unknown'
};

const STATUS_TONE: Record<McpServerStatus, ChipTone> = {
  connected: 'run',
  disabled: 'neutral',
  failed: 'err',
  needs_auth: 'wait',
  unknown: 'neutral'
};

const StatusBadge: React.FC<{ status: McpServerStatus }> = ({ status }) => (
  <Chip tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Chip>
);

const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Surface level="s1" border="default" radius="lg" className="mb-2.5 overflow-hidden">
    {children}
  </Surface>
);

const SectionHeader: React.FC<{
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  right?: React.ReactNode;
}> = ({ icon, title, subtitle, collapsed, onToggleCollapse, right }) => {
  const heading = (
    <>
      {onToggleCollapse && (
        <span className="text-ink-3 shrink-0 flex items-center">
          {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </span>
      )}
      <span className="text-ink-3 shrink-0 flex items-center">{icon}</span>
      <span className="font-mono text-[12px] font-semibold text-ink truncate">{title}</span>
      {subtitle && (
        <span className="text-[11px] text-ink-3 truncate min-w-0 font-mono" title={subtitle}>
          · {subtitle}
        </span>
      )}
    </>
  );

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 bg-surface-2 ${
        collapsed ? '' : 'border-b border-hairline'
      }`}
    >
      {onToggleCollapse ? (
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          className="flex items-center gap-2 min-w-0 flex-1 text-left bg-transparent border-0 p-0 cursor-pointer text-ink hover:text-ink"
        >
          {heading}
        </button>
      ) : (
        <div className="flex items-center gap-2 min-w-0 flex-1">{heading}</div>
      )}
      {right && <div className="flex items-center gap-1.5 shrink-0">{right}</div>}
    </div>
  );
};

interface RowProps {
  busy: boolean;
  onToggle: (tool: SessionTool, enabled: boolean) => void;
  onClear: (tool: SessionTool) => void;
}

/** Past this many rows a section folds, so one big plugin does not bury the rest. */
const FOLD_AFTER = 12;
const FOLDED_ROWS = 8;

/** A section's rows, folded behind "Show all" when there are many — unless a filter already narrowed them. */
const ToolRows: React.FC<{ tools: SessionTool[]; filtered: boolean } & RowProps> = ({ tools, filtered, ...rows }) => {
  const [open, setOpen] = useState(false);
  const folded = !open && !filtered && tools.length > FOLD_AFTER;
  return (
    <div>
      {(folded ? tools.slice(0, FOLDED_ROWS) : tools).map((tool) => (
        <ToolRow key={tool.name} tool={tool} {...rows} />
      ))}
      {folded && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full py-2 px-3 text-[12px] font-medium text-ink-3 hover:text-ink hover:bg-s3h border-0 border-t border-hairline bg-surface-2/40 cursor-pointer flex items-center justify-center gap-1 transition-colors"
        >
          <span>Show all {tools.length} tools</span>
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};

export const BuiltinGroup: React.FC<{ tools: SessionTool[]; filtered: boolean } & RowProps> = ({
  tools,
  filtered,
  ...rows
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const enabledCount = tools.filter((t) => t.enabled).length;
  return (
    <Card>
      <SectionHeader
        icon={<Wrench className="w-3.5 h-3.5" />}
        title="OpenCode built-ins"
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
        right={
          <span className="bubble is-muted">
            {enabledCount}/{tools.length}
          </span>
        }
      />
      {!collapsed && <ToolRows tools={tools} filtered={filtered} {...rows} />}
    </Card>
  );
};

export const ServerGroup: React.FC<
  {
    server: string;
    source: ToolSource;
    tools: SessionTool[];
    filtered: boolean;
    info?: McpServerInfo;
    /** Switch every tool from this server at once. */
    onToggleAll: (enabled: boolean) => void;
  } & RowProps
> = ({ server, source, tools, filtered, info, onToggleAll, ...rows }) => {
  const [collapsed, setCollapsed] = useState(false);
  const anyOn = tools.some((tool) => tool.enabled);
  const enabledCount = tools.filter((t) => t.enabled).length;
  return (
    <Card>
      <SectionHeader
        icon={
          source === 'board' ? <ClipboardList className="w-3.5 h-3.5" /> : <Server className="w-3.5 h-3.5" />
        }
        title={server}
        subtitle={info?.origin}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
        right={
          <>
            {info && <StatusBadge status={info.status} />}
            <span className="bubble is-muted">
              {enabledCount}/{tools.length}
            </span>
            <Tooltip label={`Switch every ${server} tool ${anyOn ? 'off' : 'on'}`} withArrow>
              <div className="flex items-center">
                <Switch
                  size="xs"
                  checked={anyOn}
                  disabled={rows.busy}
                  onChange={(e) => onToggleAll(e.currentTarget.checked)}
                  aria-label={`Toggle every tool from ${server}`}
                />
              </div>
            </Tooltip>
          </>
        }
      />
      {!collapsed && info?.note && (
        <div className="px-3 py-1.5 text-[11.5px] text-ink-3 border-b border-hairline bg-surface-2/30">
          {info.note}
        </div>
      )}
      {!collapsed && <ToolRows tools={tools} filtered={filtered} {...rows} />}
    </Card>
  );
};

const PLUGIN_STATUS: Record<PluginInfo['status'], { label: string; tone: ChipTone }> = {
  active: { label: 'loaded', tone: 'run' },
  failed: { label: 'failed', tone: 'err' },
  off: { label: 'off', tone: 'neutral' }
};

/**
 * One OpenCode plugin and the tools it adds. Its switch turns the whole plugin
 * off — hooks and all, not just the tools — and, on OpenCode 2, the running
 * agent drops it on its next turn. `plugin` unset is the section for plugin
 * tools the board could not pin on one plugin, which has no switch of its own.
 */
export const PluginGroup: React.FC<
  {
    plugin?: PluginInfo;
    tools: SessionTool[];
    filtered: boolean;
    /** Whether OpenCode can switch a plugin off (2.x). */
    switchable: boolean;
    onTogglePlugin: (enabled: boolean) => void;
  } & RowProps
> = ({ plugin, tools, filtered, switchable, onTogglePlugin, ...rows }) => {
  const [collapsed, setCollapsed] = useState(false);
  const on = plugin?.status !== 'off';
  const subtitle = plugin ? (plugin.builtin ? 'ships with OpenCode' : plugin.path) : undefined;
  const canSwitch = !!plugin && switchable && !plugin.anonymous;
  const enabledCount = tools.filter((t) => t.enabled).length;
  return (
    <Card>
      <SectionHeader
        icon={<Puzzle className="w-3.5 h-3.5" />}
        title={plugin?.id ?? 'Untraced plugin tools'}
        subtitle={subtitle}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
        right={
          <>
            {plugin && (
              <Chip tone={PLUGIN_STATUS[plugin.status].tone}>
                {PLUGIN_STATUS[plugin.status].label}
              </Chip>
            )}
            <span className="bubble is-muted">
              {enabledCount}/{tools.length}
            </span>
            {canSwitch && (
              <Tooltip
                label={on ? `Switch the ${plugin.id} plugin off for every session` : `Load ${plugin.id} again`}
                withArrow
              >
                <div className="flex items-center">
                  <Switch
                    size="xs"
                    checked={on}
                    disabled={rows.busy}
                    onChange={(e) => onTogglePlugin(e.currentTarget.checked)}
                    aria-label={`Toggle the ${plugin.id} plugin`}
                  />
                </div>
              </Tooltip>
            )}
          </>
        }
      />
      {!collapsed && (
        <>
          {plugin?.error && (
            <div className="px-3 py-1.5 text-[11.5px] text-err-fg font-mono break-all border-b border-hairline bg-err-bg/40">
              {plugin.error}
            </div>
          )}
          {plugin?.anonymous && (
            <div className="px-3 py-1.5 text-[11.5px] text-ink-3 border-b border-hairline">
              OpenCode 2 could not load it, so it has no id to switch off by. Fix or remove the file.
            </div>
          )}
          {!plugin && (
            <div className="px-3 py-1.5 text-[11.5px] text-ink-3 border-b border-hairline">
              {switchable
                ? 'Added by a plugin the board could not trace. Switch them one by one.'
                : 'From plugins or .opencode/tool files. OpenCode 1.x cannot switch a plugin off, so switch its tools one by one.'}
            </div>
          )}
          {plugin && !on && tools.length === 0 && (
            <div className="px-3 py-2 text-[11.5px] text-ink-3">
              Switched off here, so OpenCode does not load it.
            </div>
          )}
          {plugin && on && tools.length === 0 && !plugin.error && (
            <div className="px-3 py-2 text-[11.5px] text-ink-3">
              Adds no tools — it hooks into OpenCode in other ways.
            </div>
          )}
          <ToolRows tools={tools} filtered={filtered} {...rows} />
        </>
      )}
    </Card>
  );
};

/** Past this many, the list of OpenCode's quiet plugins folds. */
const QUIET_FOLDED = 6;

/**
 * OpenCode's own plugins that add no tools of their own — LSP, sharing,
 * formatters and the like — in one folded list, each with its switch. Off is
 * off for every session, the same as any plugin.
 */
export const QuietPluginsGroup: React.FC<{
  plugins: PluginInfo[];
  filtered: boolean;
  busy: boolean;
  onTogglePlugin: (id: string, enabled: boolean) => void;
}> = ({ plugins, filtered, busy, onTogglePlugin }) => {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const folded = !open && !filtered && plugins.length > QUIET_FOLDED;
  return (
    <Card>
      <SectionHeader
        icon={<Puzzle className="w-3.5 h-3.5" />}
        title="OpenCode's own plugins"
        subtitle="no tools of their own"
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
        right={<span className="bubble is-muted">{plugins.length}</span>}
      />
      {!collapsed &&
        (folded ? [] : plugins).map((plugin) => (
          <div
            key={plugin.id}
            className="flex items-center gap-2.5 px-3 py-2 border-b border-hairline last:border-b-0 hover:bg-s3h transition-colors"
          >
            <Switch
              size="xs"
              checked={plugin.status !== 'off'}
              disabled={busy}
              onChange={(e) => onTogglePlugin(plugin.id, e.currentTarget.checked)}
              aria-label={`Toggle the ${plugin.id} plugin`}
              className="shrink-0"
            />
            <span
              className={`font-mono text-[12px] truncate ${
                plugin.status === 'off' ? 'text-ink-4 line-through' : 'text-ink'
              }`}
              title={plugin.id}
            >
              {plugin.id}
            </span>
          </div>
        ))}
      {!collapsed && folded && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full py-2 px-3 text-[12px] font-medium text-ink-3 hover:text-ink hover:bg-s3h border-0 bg-surface-2/40 cursor-pointer flex items-center justify-center gap-1 transition-colors"
        >
          <span>Show all {plugins.length} plugins</span>
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      )}
    </Card>
  );
};

export const EmptyServerGroup: React.FC<{ server: McpServerInfo }> = ({ server }) => (
  <Card>
    <SectionHeader
      icon={<Server className="w-3.5 h-3.5" />}
      title={server.name}
      subtitle={server.origin}
      right={<StatusBadge status={server.status} />}
    />
    <div className="px-3 py-2 text-[12px] text-ink-3">
      {server.note || 'No tools listed for this server.'}
    </div>
  </Card>
);
