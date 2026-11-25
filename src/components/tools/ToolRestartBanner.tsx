import React from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { Banner, Button } from '../ui';

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
  <Banner
    strip
    tone={needsForce ? 'err' : 'wait'}
    icon={<AlertTriangle className="w-3.5 h-3.5" />}
    actions={
      <Button
        size="xs"
        variant={needsForce ? 'danger' : 'wait'}
        loading={restarting}
        leftSection={<RotateCw className="w-3 h-3" />}
        onClick={onRestart}
      >
        {needsForce ? 'Restart anyway' : 'Restart agent'}
      </Button>
    }
  >
    {needsForce
      ? 'Sessions are still running. Restarting now drops the turns in flight.'
      : 'The running agent still has the old tool list. Restarting applies it and drops turns in flight.'}
  </Banner>
);
