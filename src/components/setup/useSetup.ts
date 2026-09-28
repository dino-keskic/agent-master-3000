import { useCallback, useEffect, useState } from 'react';
import { SetupPatch, SetupReport, SetupSaveResult } from '../../../shared/setup/report';
import { api } from '../../api';

/**
 * The setup report — where the board and OpenCode are, and whether each is
 * there — and saving a change to it. Held at the board's top so the header's
 * settings button, the settings panel and the welcome screen show one report.
 */

export interface Setup {
  report?: SetupReport;
  error?: string;
  /** What the last save did to the agent; cleared on the next reload. */
  agent?: SetupSaveResult['agent'];
  reload: () => void;
  save: (patch: SetupPatch) => Promise<void>;
}

export function useSetup(): Setup {
  const [report, setReport] = useState<SetupReport>();
  const [error, setError] = useState<string>();
  const [agent, setAgent] = useState<SetupSaveResult['agent']>();
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .setup()
      .then((next) => {
        if (cancelled) return;
        setReport(next);
        setError(undefined);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [generation]);

  const reload = useCallback(() => {
    setAgent(undefined);
    setGeneration((n) => n + 1);
  }, []);

  /** Throws the server's refusal, so the row that asked can show it. */
  const save = useCallback(async (patch: SetupPatch) => {
    const result = await api.saveSetup(patch);
    setReport(result.report);
    setAgent(result.agent);
  }, []);

  return { report, error, agent, reload, save };
}
