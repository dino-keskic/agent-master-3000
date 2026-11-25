import React from 'react';
import { Check } from 'lucide-react';
import { ProjectFolder } from '../../../shared/types';
import { BoardMark } from '../loading/BoardMark';
import { Setup } from '../setup/useSetup';
import { Surface } from '../ui';
import { ChooseProjectStep } from './ChooseProjectStep';
import { ImportSessionsStep } from './ImportSessionsStep';
import { SetupStep } from './SetupStep';

/**
 * What a new board shows instead of itself: check where the data and
 * OpenCode are, pick a project, then decide whether to bring over the
 * sessions OpenCode already has in it.
 */

interface WelcomeScreenProps {
  setup: Setup;
  /** Past the locations step. */
  locationsConfirmed: boolean;
  onConfirmLocations: () => void;
  /** The project just added; absent until the first step is done. */
  project?: ProjectFolder;
  isPickingFolder: boolean;
  onPickFolder: () => unknown;
  onAddFolder: (name: string, folderPath: string) => Promise<unknown>;
  onImport: (project: ProjectFolder) => void;
  onFinish: () => void;
}

const STEPS = [
  { id: 1, label: 'Locations' },
  { id: 2, label: 'Project' },
  { id: 3, label: 'Sessions' }
];

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  setup,
  locationsConfirmed,
  onConfirmLocations,
  project,
  isPickingFolder,
  onPickFolder,
  onAddFolder,
  onImport,
  onFinish
}) => {
  const currentStep = !locationsConfirmed ? 1 : !project ? 2 : 3;

  return (
    <div className="min-h-screen text-ink font-sans flex items-center justify-center p-6">
      <div className="flex flex-col items-center gap-6 w-full max-w-[560px]">
        <BoardMark />

        {/* Step progress indicator */}
        <div className="flex items-center gap-2">
          {STEPS.map((step, index) => {
            const done = step.id < currentStep;
            const active = step.id === currentStep;
            return (
              <React.Fragment key={step.id}>
                {index > 0 && <span className="w-6 h-px bg-line" />}
                <div
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-medium border ${
                    active
                      ? 'bg-acc-bg border-acc-bd text-acc-fg'
                      : done
                        ? 'bg-run-bg border-run-bd text-run-fg'
                        : 'bg-surface border-line text-ink-4'
                  }`}
                >
                  <span className="font-mono text-[10.5px]">
                    {done ? <Check className="w-3 h-3" /> : `${step.id}.`}
                  </span>
                  <span>{step.label}</span>
                </div>
              </React.Fragment>
            );
          })}
        </div>

        <Surface level="s2" variant="card" border="default" radius="xl" className="w-full p-6">
          {!locationsConfirmed ? (
            <SetupStep setup={setup} onContinue={onConfirmLocations} />
          ) : project ? (
            <ImportSessionsStep project={project} onImport={() => onImport(project)} onSkip={onFinish} />
          ) : (
            <ChooseProjectStep
              isPickingFolder={isPickingFolder}
              onPickFolder={onPickFolder}
              onAddFolder={onAddFolder}
            />
          )}
        </Surface>
      </div>
    </div>
  );
};
