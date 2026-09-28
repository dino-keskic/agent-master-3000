import React from 'react';
import { setupSeverity } from '../../../shared/setup/report';
import { Button } from '../ui/Button';
import { LocationList } from '../setup/LocationList';
import { RestartNotice } from '../setup/RestartNotice';
import { Setup } from '../setup/useSetup';

/**
 * The welcome screen's first step: where the board keeps its data and where
 * it found OpenCode. Usually a glance and "Continue"; it is here for the
 * machine where OpenCode lives somewhere unusual, and for someone who already
 * has a board in another folder and wants this one to use it.
 */

interface SetupStepProps {
  setup: Setup;
  onContinue: () => void;
}

export const SetupStep: React.FC<SetupStepProps> = ({ setup, onContinue }) => {
  const { report, error } = setup;
  const severity = report ? setupSeverity(report.locations) : 'ok';
  const noOpenCode = report?.locations.some((l) => l.key === 'opencodeBin' && l.severity === 'error');

  return (
    <div className="flex flex-col gap-5 w-full">
      <div className="flex flex-col gap-1.5 text-center">
        <h2 className="m-0 text-lg font-semibold text-ink">Check where things are</h2>
        <p className="m-0 text-log-ui text-ink-3">
          Where this board keeps its data, and where it found OpenCode. You can change any of it later from Settings.
        </p>
      </div>

      {error && <p className="m-0 text-log-ui text-err-fg">Could not read the setup: {error}</p>}
      {!report && !error && <p className="m-0 text-log-ui text-ink-4">Looking…</p>}
      {report && (
        <>
          <RestartNotice setup={setup} />
          <LocationList report={report} save={setup.save} />
          {noOpenCode && (
            <p className="m-0 text-log-ui text-ink-3">
              Tasks run through OpenCode, so the board needs it. Install it from{' '}
              <a className="text-accent" href="https://opencode.ai" target="_blank" rel="noreferrer">
                opencode.ai
              </a>{' '}
              and check again, or point the board at where it is.
            </p>
          )}
        </>
      )}

      <div className="flex justify-end gap-2">
        {noOpenCode && (
          <Button variant="ghost" onClick={setup.reload}>
            Check again
          </Button>
        )}
        <Button variant={severity === 'error' ? 'secondary' : 'primary'} onClick={onContinue} disabled={!report && !error}>
          {severity === 'error' ? 'Continue anyway' : 'Continue'}
        </Button>
      </div>
    </div>
  );
};
