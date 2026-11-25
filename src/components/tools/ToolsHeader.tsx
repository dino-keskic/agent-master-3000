import React from 'react';
import { Tooltip } from '@mantine/core';
import { RefreshCw } from 'lucide-react';
import { SessionToolInventory, ToolStatusFilter } from '../../../shared/agent/tools';
import { Chip, PaneToolbar, SearchInput, SegmentedControl } from '../ui';

/** The filter box, quick status filter, enabled count, and a way to re-read the list. */

interface ToolsHeaderProps {
  inventory: SessionToolInventory | null;
  filter: string;
  onFilterChange: (filter: string) => void;
  status: ToolStatusFilter;
  onStatusChange: (status: ToolStatusFilter) => void;
  onRefresh: () => void;
}

export const ToolsHeader: React.FC<ToolsHeaderProps> = ({
  inventory,
  filter,
  onFilterChange,
  status,
  onStatusChange,
  onRefresh
}) => {
  const tools = inventory?.tools || [];
  const enabledCount = tools.filter((tool) => tool.enabled).length;
  const offCount = tools.length - enabledCount;

  return (
    <PaneToolbar
      left={
        <div className="flex items-center gap-2 flex-wrap">
          <SearchInput
            value={filter}
            onChange={onFilterChange}
            placeholder="Filter tools by name or description…"
            containerClassName="w-60 max-w-full"
          />
          {inventory && !inventory.error && (
            <SegmentedControl<ToolStatusFilter>
              size="xs"
              value={status}
              onChange={onStatusChange}
              options={[
                { value: 'all', label: 'All', count: tools.length },
                { value: 'on', label: 'On', count: enabledCount },
                { value: 'off', label: 'Off', count: offCount }
              ]}
            />
          )}
        </div>
      }
      right={
        <>
          {inventory && !inventory.error && (
            <div className="flex items-center gap-1.5">
              <Chip tone="run" className="font-mono">
                {enabledCount} available
              </Chip>
              {offCount > 0 && (
                <Chip className="font-mono text-ink-3">
                  {offCount} off
                </Chip>
              )}
              {inventory.agent && (
                <Chip tone="accent" className="font-mono">
                  {inventory.agent}
                </Chip>
              )}
            </div>
          )}
          <Tooltip label="Re-read the tool list" withArrow>
            <button
              type="button"
              className="icon-btn"
              onClick={onRefresh}
              aria-label="Refresh tools"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </>
      }
    />
  );
};
