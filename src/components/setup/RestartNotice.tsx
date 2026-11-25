import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, RotateCw } from 'lucide-react';
import { needsBoardRestart } from '../../../shared/setup/report';
import { api } from '../../api';
import { Banner, Button } from '../ui';
import { Setup } from './useSetup';

/**
 * What still has to restart before a saved change is felt.
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
    <Banner
      tone={agent === 'restarted' && !boardRestart ? 'run' : 'wait'}
      icon={
        agent === 'restarted' && !boardRestart ? (
          <CheckCircle2 className="w-4 h-4" />
        ) : (
          <AlertTriangle className="w-4 h-4" />
        )
      }
      actions={
        agent === 'busy' ? (
          <Button
            size="xs"
            variant="wait"
            loading={restarting}
            onClick={() => void restartAgent()}
            leftSection={<RotateCw className="w-3 h-3" />}
          >
            Restart now
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-1">
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
          <p className="m-0">
            OpenCode picks this up when it restarts. Tasks are running, so it has not yet.
          </p>
        )}
        {error && <p className="m-0 text-err-fg">{error}</p>}
      </div>
    </Banner>
  );
};
