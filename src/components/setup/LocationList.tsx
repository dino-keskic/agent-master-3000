import React from 'react';
import { DataMove, LocationKey, SetupReport } from '../../../shared/setup/report';
import { Setup } from './useSetup';
import { LocationRow } from './LocationRow';

/**
 * Every location in the report, one row each, in the order the setup screens
 * list them. Shared by the welcome screen's first step and the settings panel.
 */

interface LocationListProps {
  report: SetupReport;
  save: Setup['save'];
}

export const LocationList: React.FC<LocationListProps> = ({ report, save }) => {
  const saveOne = (key: LocationKey) => (value: string | null, dataMove?: DataMove) =>
    save({ locations: { [key]: value }, dataMove });

  return (
    <div className="flex flex-col gap-2">
      <ul className="m-0 p-0 list-none flex flex-col rounded-lg border border-line bg-surface overflow-hidden">
        {report.locations.map((status) => (
          <LocationRow
            key={status.key}
            status={status}
            candidates={status.key === 'opencodeBin' ? report.binCandidates.filter((c) => c !== status.value) : undefined}
            onSave={saveOne(status.key)}
          />
        ))}
      </ul>
      {report.stateFileOverride && (
        <p className="m-0 text-log-sm text-wait-fg">
          $BOARD_STATE_FILE keeps this board’s tasks in{' '}
          <span className="font-mono break-all">{report.stateFileOverride}</span>, whatever the data folder says.
        </p>
      )}
    </div>
  );
};
