import React, { useState } from 'react';
import { RotateCw } from 'lucide-react';
import { api } from '../../api';
import { Button } from '../ui/Button';

/**
 * An OpenCode config file changed while tasks were running. OpenCode reads its
 * config once, at start, so the models and agents on offer are the old ones
 * until it restarts — which the board does on its own once nothing is running,
 * or here, now, at the cost of the running turns.
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
    <div className="mb-4 flex items-center gap-3 rounded-lg border border-wait-bd bg-wait-bg px-3 py-2 text-log-ui text-ink-2">
      <p className="m-0 flex-1">
        OpenCode’s config changed. New models and agents show up when it restarts — on its own once no task is
        running, or now, which stops the running turns.
        {error && <span className="text-err-fg"> {error}</span>}
      </p>
      <Button size="sm" variant="wait" loading={restarting} onClick={() => void restart()} leftSection={<RotateCw className="w-3.5 h-3.5" />}>
        Restart now
      </Button>
    </div>
  );
};
