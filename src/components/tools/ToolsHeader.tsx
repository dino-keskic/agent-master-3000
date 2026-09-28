import React from 'react';
import { Button, Group, Text, TextInput, Tooltip } from '@mantine/core';
import { RefreshCw, Search } from 'lucide-react';
import { SessionToolInventory } from '../../../shared/agent/tools';

/** The filter box, the count of what is on, and a way to re-read the list. */

interface ToolsHeaderProps {
  inventory: SessionToolInventory | null;
  filter: string;
  onFilterChange: (filter: string) => void;
  onRefresh: () => void;
}

export const ToolsHeader: React.FC<ToolsHeaderProps> = ({ inventory, filter, onFilterChange, onRefresh }) => {
  const tools = inventory?.tools || [];
  const enabledCount = tools.filter((tool) => tool.enabled).length;
  const offCount = tools.length - enabledCount;

  return (
    <Group justify="space-between" px="sm" py={8} gap="xs" className="border-b border-line/80 shrink-0" wrap="nowrap">
      <TextInput
        size="xs"
        placeholder="Filter tools"
        value={filter}
        onChange={(e) => onFilterChange(e.currentTarget.value)}
        leftSection={<Search className="w-3 h-3" />}
        className="max-w-56"
      />
      <Group gap="xs" wrap="nowrap">
        {inventory && !inventory.error && (
          <Text size="xs" className="font-mono text-ink-2">
            <span className="text-emerald-400">{enabledCount}</span> available
            {offCount > 0 && <span className="text-ink-4"> · {offCount} off</span>}
            {inventory.agent && <span className="text-ink-4"> · {inventory.agent}</span>}
          </Text>
        )}
        <Tooltip label="Re-read the tool list" withArrow>
          <Button
            size="compact-xs"
            variant="subtle"
            color="gray"
            onClick={onRefresh}
            aria-label="Refresh tools"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </Tooltip>
      </Group>
    </Group>
  );
};
