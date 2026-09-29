import React from 'react';
import { Badge, Group, Switch, Text, Tooltip } from '@mantine/core';
import { ClipboardList, Server, Wrench } from 'lucide-react';
import { McpServerInfo, McpServerStatus, SessionTool, ToolSource } from '../../../shared/agent/tools';
import { ToolRow } from './ToolRow';

/**
 * A boxed section of the panel: built-ins, or one MCP server and its tools.
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

const STATUS_COLOR: Record<McpServerStatus, string> = {
  connected: 'teal',
  disabled: 'gray',
  failed: 'red',
  needs_auth: 'yellow',
  unknown: 'gray'
};

const StatusBadge: React.FC<{ status: McpServerStatus }> = ({ status }) => (
  <Badge size="xs" variant="light" color={STATUS_COLOR[status]}>
    {STATUS_LABEL[status]}
  </Badge>
);

const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mb-2 rounded-lg border border-line/70 overflow-hidden bg-canvas/40">{children}</div>
);

const SectionHeader: React.FC<{
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}> = ({ icon, title, subtitle, right }) => (
  <Group gap={6} wrap="nowrap" px="xs" py={6} className="bg-slate-900/60">
    <span className="text-ink-3 shrink-0">{icon}</span>
    <Text size="xs" className="font-mono text-ink truncate">
      {title}
    </Text>
    {subtitle && (
      <Text size="10px" c="dimmed" className="truncate min-w-0" title={subtitle}>
        {subtitle}
      </Text>
    )}
    <div className="flex-1" />
    {right}
  </Group>
);

interface RowProps {
  busy: boolean;
  onToggle: (tool: SessionTool, enabled: boolean) => void;
  onClear: (tool: SessionTool) => void;
}

export const BuiltinGroup: React.FC<{ tools: SessionTool[] } & RowProps> = ({ tools, ...rows }) => (
  <Card>
    <SectionHeader
      icon={<Wrench className="w-3.5 h-3.5" />}
      title="OpenCode built-ins"
      right={
        <Badge size="xs" variant="light" color="gray" className="font-mono">
          {tools.length}
        </Badge>
      }
    />
    {tools.map((tool) => (
      <ToolRow key={tool.name} tool={tool} {...rows} />
    ))}
  </Card>
);

export const ServerGroup: React.FC<
  {
    server: string;
    source: ToolSource;
    tools: SessionTool[];
    info?: McpServerInfo;
    /** Switch every tool from this server at once. */
    onToggleAll: (enabled: boolean) => void;
  } & RowProps
> = ({ server, source, tools, info, onToggleAll, ...rows }) => {
  const anyOn = tools.some((tool) => tool.enabled);
  return (
    <Card>
      <SectionHeader
        icon={
          source === 'board' ? <ClipboardList className="w-3.5 h-3.5" /> : <Server className="w-3.5 h-3.5" />
        }
        title={server}
        subtitle={info?.origin}
        right={
          <Group gap={6} wrap="nowrap">
            {info && <StatusBadge status={info.status} />}
            <Badge size="xs" variant="light" color="gray" className="font-mono">
              {tools.length}
            </Badge>
            <Tooltip label={`Switch every ${server} tool ${anyOn ? 'off' : 'on'}`} withArrow>
              <Switch
                size="xs"
                checked={anyOn}
                disabled={rows.busy}
                onChange={(e) => onToggleAll(e.currentTarget.checked)}
                aria-label={`Toggle every tool from ${server}`}
              />
            </Tooltip>
          </Group>
        }
      />
      {info?.note && (
        <Text size="xs" c="dimmed" px="xs" py={4}>
          {info.note}
        </Text>
      )}
      {tools.map((tool) => (
        <ToolRow key={tool.name} tool={tool} {...rows} />
      ))}
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
    <Text size="xs" c="dimmed" px="xs" py={6}>
      {server.note || 'No tools listed for this server.'}
    </Text>
  </Card>
);
