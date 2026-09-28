import React, { useState } from 'react';
import { RotateCw } from 'lucide-react';
import { needsBoardRestart } from '../../../shared/setup/report';
import { api } from '../../api';
import { Button } from '../ui/Button';
import { Setup } from './useSetup';

/**
 * What still has to restart before a saved change is felt. The data folder is
 * opened once, at start, so moving it waits for the board; OpenCode is
 * restarted by the save itself unless turns are running, and then it is
 * offered here — restarting it drops them.
 */

export const RestartNotice: React.FC<{ setup: Setup }> = ({ setup }) => {
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string>();
  const { report, agent } = setup;
  if (!report) return null;

  const boardRestart = needsBoardRestart(report);
  if (!boardRestart && agent !== 'busy' && agent !== 'restarted') return null;

  const restartAgent = async () => {
    setRestarting(true);
    try {
      await api.restartAgent(true);
      setup.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRestarting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-wait-bd bg-wait-bg px-3 py-2.5 text-log-ui text-ink-2">
      {boardRestart && (
        <p className="m-0">
          <strong>Restart the board</strong> to switch to the new data folder.
          {report.pendingMove
            ? ` It will copy this board from ${report.pendingMove.from} on the way.`
            : ' Until then it keeps using the old one.'}
        </p>
      )}
      {agent === 'restarted' && <p className="m-0">OpenCode was restarted with the new setup.</p>}
      {agent === 'busy' && (
        <div className="flex items-center gap-3">
          <p className="m-0 flex-1">OpenCode picks this up when it restarts. Tasks are running, so it has not yet.</p>
          <Button size="sm" variant="wait" loading={restarting} onClick={() => void restartAgent()} leftSection={<RotateCw className="w-3.5 h-3.5" />}>
            Restart now
          </Button>
        </div>
      )}
      {error && <p className="m-0 text-err-fg">{error}</p>}
    </div>
  );
};
