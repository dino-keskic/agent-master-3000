import React, { useState } from 'react';
import { Group, Loader, ScrollArea } from '@mantine/core';
import { ToolRestartBanner } from './ToolRestartBanner';
import { ToolsHeader } from './ToolsHeader';
import { ToolsList } from './ToolsList';
import { useSessionTools } from './useSessionTools';

/**
 * What this session's agent can call, as OpenCode resolves it, with a switch on
 * every row.
 *
 * A switch here takes the tool out of the list the agent is given rather than
 * refusing the call afterwards — which is why turning one off leaves the
 * running agent behind until it restarts.
 */

interface ToolsPanelProps {
  taskId: string;
  sessionId?: string;
  /** The agent's tool list only changes between turns, so this drives a refresh. */
  running?: boolean;
}

export const ToolsPanel: React.FC<ToolsPanelProps> = ({ taskId, sessionId, running = false }) => {
  const { inventory, loading, busy, restarting, needsForce, reload, save, restart } = useSessionTools(
    taskId,
    sessionId,
    running
  );
  const [filter, setFilter] = useState('');

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <ToolsHeader
        inventory={inventory}
        filter={filter}
        onFilterChange={setFilter}
        onRefresh={() => reload(true)}
      />

      {inventory?.pendingRestart && (
        <ToolRestartBanner needsForce={needsForce} restarting={restarting} onRestart={restart} />
      )}

      <ScrollArea className="flex-1 min-h-0">
        {loading ? (
          <Group justify="center" py="xl">
            <Loader size="sm" color="gray" />
          </Group>
        ) : inventory ? (
          <ToolsList inventory={inventory} filter={filter} busy={busy} onSave={save} />
        ) : null}
      </ScrollArea>
    </div>
  );
};
