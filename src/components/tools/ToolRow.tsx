import React from 'react';
import { Badge, Button, Group, Switch, Text, Tooltip } from '@mantine/core';
import { Undo2 } from 'lucide-react';
import { SessionTool } from '../../../shared/agent/tools';

/**
 * One tool, and why it is in the state it is in.
 *
 * The tooltip is the whole point of the row: a switch that is off says nothing
 * about *who* turned it off, and "my OpenCode config did" and "the board did"
 * lead to different places to go and fix it.
 */
function stateLabel(tool: SessionTool): string {
  if (tool.policyOverridden) {
    const said = tool.policy ? 'on' : 'off';
    const does = tool.enabled ? 'back on' : `off with \`${tool.disabledByRule}\``;
    return `Switched ${said} here, but an OpenCode config read after the board's — most likely this project's — turns it ${does}, and has the last word.`;
  }
  if (tool.disabledBy === 'board') return 'Blocked here — the agent is never offered this tool.';
  if (tool.disabledBy === 'agent') return `Turned off for this agent by \`${tool.disabledByRule}\` in your OpenCode config.`;
  if (tool.disabledBy === 'config') return `Turned off by \`${tool.disabledByRule}\` in your OpenCode config.`;
  if (tool.disabledBy === 'server') return 'Its MCP server is not connected, so the agent never sees it.';
  if (tool.policy === true) return 'Switched back on here, over your OpenCode config.';
  return 'Available to the agent.';
}

/** A tool the board cannot hand back: its server is not there to be asked. */
function isLockedOff(tool: SessionTool): boolean {
  return tool.disabledBy === 'server';
}

export const ToolRow: React.FC<{
  tool: SessionTool;
  busy: boolean;
  onToggle: (tool: SessionTool, enabled: boolean) => void;
  onClear: (tool: SessionTool) => void;
}> = ({ tool, busy, onToggle, onClear }) => (
  <Group gap={8} wrap="nowrap" px="xs" py={5} className="border-b border-slate-900/80 last:border-b-0">
    <Tooltip label={stateLabel(tool)} withArrow multiline w={260}>
      <Switch
        size="xs"
        checked={tool.enabled}
        disabled={busy || isLockedOff(tool)}
        onChange={(e) => onToggle(tool, e.currentTarget.checked)}
        aria-label={`${tool.enabled ? 'Block' : 'Allow'} ${tool.name}`}
        className="shrink-0"
      />
    </Tooltip>
    <Text
      size="xs"
      className={`font-mono truncate ${tool.enabled ? 'text-ink' : 'text-ink-4 line-through'}`}
      title={tool.name}
    >
      {tool.name}
    </Text>
    {tool.description && (
      <Text size="xs" c="dimmed" className="truncate min-w-0" title={tool.description}>
        {tool.description}
      </Text>
    )}
    <div className="flex-1" />
    {tool.used > 0 && (
      <Tooltip label={`Called ${tool.used}× in this session`} withArrow>
        <Badge size="xs" variant="light" color="accent" className="font-mono shrink-0">
          {tool.used}×
        </Badge>
      </Tooltip>
    )}
    {tool.policy !== undefined && (
      <Tooltip label="Drop the board's override and follow your OpenCode config again" withArrow>
        <Button
          size="compact-xs"
          variant="subtle"
          color="gray"
          disabled={busy}
          onClick={() => onClear(tool)}
          aria-label={`Clear the board override on ${tool.name}`}
        >
          <Undo2 className="w-3 h-3" />
        </Button>
      </Tooltip>
    )}
    {tool.policyOverridden && (
      <Tooltip label={stateLabel(tool)} withArrow multiline w={260}>
        <Badge size="xs" variant="light" color="yellow" className="shrink-0">
          outvoted
        </Badge>
      </Tooltip>
    )}
    {!tool.enabled && tool.disabledBy !== 'board' && !tool.policyOverridden && (
      <Tooltip label={stateLabel(tool)} withArrow multiline w={260}>
        <Badge size="xs" variant="light" color="gray" className="shrink-0">
          {tool.disabledBy === 'server' ? 'no server' : 'config'}
        </Badge>
      </Tooltip>
    )}
  </Group>
);
