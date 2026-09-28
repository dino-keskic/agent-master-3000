import React from 'react';
import { Button, Group, Text } from '@mantine/core';
import { RotateCw } from 'lucide-react';

/**
 * A saved switch only reaches the agent when it starts, so a change made
 * mid-session says so — and says what restarting costs, since turns in flight
 * do not survive it.
 */

interface ToolRestartBannerProps {
  /** True when a session is still running, which makes the restart destructive. */
  needsForce: boolean;
  restarting: boolean;
  onRestart: () => void;
}

export const ToolRestartBanner: React.FC<ToolRestartBannerProps> = ({ needsForce, restarting, onRestart }) => (
  <Group
    justify="space-between"
    px="sm"
    py={6}
    gap="xs"
    wrap="nowrap"
    className="bg-amber-950/50 border-b border-amber-900/60 shrink-0"
  >
    <Text size="xs" className="text-amber-200">
      {needsForce
        ? 'Sessions are still running. Restarting now drops the turns in flight.'
        : 'The running agent still has the old tool list. Restarting applies it and drops turns in flight.'}
    </Text>
    <Button
      size="compact-xs"
      variant="light"
      color={needsForce ? 'red' : 'yellow'}
      loading={restarting}
      leftSection={<RotateCw className="w-3 h-3" />}
      onClick={onRestart}
    >
      {needsForce ? 'Restart anyway' : 'Restart agent'}
    </Button>
  </Group>
);
