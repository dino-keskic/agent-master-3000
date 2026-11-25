import React from 'react';
import { Switch, Tooltip } from '@mantine/core';
import { Undo2 } from 'lucide-react';
import { SessionTool } from '../../../shared/agent/tools';
import { Chip } from '../ui';

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
  if (tool.disabledBy === 'plugin') return `Its plugin, ${tool.plugin}, is switched off here. Switch the plugin back on to get it.`;
  if (tool.policy === true) return 'Switched back on here, over your OpenCode config.';
  return 'Available to the agent.';
}

/** A tool the board cannot hand back on its own: its server or plugin is not there. */
function isLockedOff(tool: SessionTool): boolean {
  return tool.disabledBy === 'server' || tool.disabledBy === 'plugin';
}

const OFF_BADGE: Partial<Record<NonNullable<SessionTool['disabledBy']>, string>> = {
  server: 'no server',
  plugin: 'plugin off',
  agent: 'agent rule',
  config: 'config'
};

export const ToolRow: React.FC<{
  tool: SessionTool;
  busy: boolean;
  onToggle: (tool: SessionTool, enabled: boolean) => void;
  onClear: (tool: SessionTool) => void;
}> = ({ tool, busy, onToggle, onClear }) => (
  <div className="flex items-center gap-2.5 px-3 py-2 border-b border-hairline last:border-b-0 hover:bg-s3h transition-colors">
    <Tooltip label={stateLabel(tool)} withArrow multiline w={260}>
      <div className="shrink-0 flex items-center">
        <Switch
          size="xs"
          checked={tool.enabled}
          disabled={busy || isLockedOff(tool)}
          onChange={(e) => onToggle(tool, e.currentTarget.checked)}
          aria-label={`${tool.enabled ? 'Block' : 'Allow'} ${tool.name}`}
        />
      </div>
    </Tooltip>

    <span
      className={`font-mono text-[12px] font-medium truncate shrink-0 max-w-[48%] ${
        tool.enabled ? 'text-ink' : 'text-ink-4 line-through'
      }`}
      title={tool.name}
    >
      {tool.name}
    </span>

    {tool.description ? (
      <span className="text-[12px] text-ink-3 truncate min-w-0 flex-1" title={tool.description}>
        {tool.description}
      </span>
    ) : (
      <div className="flex-1" />
    )}

    <div className="flex items-center gap-1.5 shrink-0">
      {tool.used > 0 && (
        <Tooltip label={`Called ${tool.used}× in this session`} withArrow>
          <Chip tone="accent" className="font-mono">
            {tool.used}×
          </Chip>
        </Tooltip>
      )}
      {tool.policy !== undefined && (
        <Tooltip label="Drop the board's override and follow your OpenCode config again" withArrow>
          <button
            type="button"
            className="icon-btn w-6 h-6"
            disabled={busy}
            onClick={() => onClear(tool)}
            aria-label={`Clear the board override on ${tool.name}`}
          >
            <Undo2 className="w-3 h-3" />
          </button>
        </Tooltip>
      )}
      {tool.policyOverridden && (
        <Tooltip label={stateLabel(tool)} withArrow multiline w={260}>
          <Chip tone="wait">outvoted</Chip>
        </Tooltip>
      )}
      {!tool.enabled && tool.disabledBy !== 'board' && !tool.policyOverridden && (
        <Tooltip label={stateLabel(tool)} withArrow multiline w={260}>
          <Chip>{(tool.disabledBy && OFF_BADGE[tool.disabledBy]) || 'config'}</Chip>
        </Tooltip>
      )}
    </div>
  </div>
);
