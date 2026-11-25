import React, { useState } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { api } from '../../api';
import { Banner, Button } from '../ui';

/**
 * An OpenCode config file changed while tasks were running.
 */

export const ConfigStaleNotice: React.FC<{ onRestarted: () => void }> = ({ onRestarted }) => {
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string>();

  const restart = async () => {
    setRestarting(true);
    setError(undefined);
    try {
      await api.restartAgent(true);
      onRestarted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRestarting(false);
    }
  };

  return (
    <Banner
      tone="wait"
      icon={<AlertTriangle className="w-4 h-4" />}
      className="mb-4"
      actions={
        <Button
          size="xs"
          variant="wait"
          loading={restarting}
          onClick={() => void restart()}
          leftSection={<RotateCw className="w-3 h-3" />}
        >
          Restart now
        </Button>
      }
    >
      OpenCode’s config changed. New models and agents show up when it restarts — on its own once no task is
      running, or now, which stops the running turns.
      {error && <span className="text-err-fg"> {error}</span>}
    </Banner>
  );
};
