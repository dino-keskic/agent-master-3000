import React from 'react';
import { ProjectFolder } from '../../../shared/types';
import { BoardMark } from '../loading/BoardMark';
import { ChooseProjectStep } from './ChooseProjectStep';
import { ImportSessionsStep } from './ImportSessionsStep';
import { SetupStep } from './SetupStep';
import { Setup } from '../setup/useSetup';

/**
 * What a new board shows instead of itself: check where the data and
 * OpenCode are, pick a project, then decide whether to bring over the
 * sessions OpenCode already has in it. Which step is
 * on screen is `useOnboarding`'s call; this only arranges them.
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
}) => (
  <div className="min-h-screen bg-canvas text-ink font-sans flex items-center justify-center p-6">
    <div className="flex flex-col items-center gap-8 w-full max-w-[560px]">
      <BoardMark />
      <div className="w-full rounded-xl border border-line bg-surface-2 shadow-card p-6">
        {!locationsConfirmed ? (
          <SetupStep setup={setup} onContinue={onConfirmLocations} />
        ) : project ? (
          <ImportSessionsStep project={project} onImport={() => onImport(project)} onSkip={onFinish} />
        ) : (
          <ChooseProjectStep isPickingFolder={isPickingFolder} onPickFolder={onPickFolder} onAddFolder={onAddFolder} />
        )}
      </div>
    </div>
  </div>
);
