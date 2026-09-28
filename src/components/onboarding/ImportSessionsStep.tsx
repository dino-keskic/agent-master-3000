import React from 'react';
import { CheckCircle2, History } from 'lucide-react';
import { ProjectFolder } from '../../../shared/types';
import { Button } from '../ui/Button';
import { useFolderSessionCount } from './useProjectSuggestions';

/**
 * The second step: the project is on the board, and OpenCode may already have
 * work in it. Importing is offered, never done for the user — a busy repo has
 * hundreds of sessions, and which of them deserve a card is theirs to say.
 */

interface ImportSessionsStepProps {
  project: ProjectFolder;
  onImport: () => void;
  onSkip: () => void;
}

export const ImportSessionsStep: React.FC<ImportSessionsStepProps> = ({ project, onImport, onSkip }) => {
  const count = useFolderSessionCount(project.path);

  return (
    <div className="flex flex-col items-center gap-5 w-full text-center">
      <div className="flex flex-col items-center gap-1.5">
        <h2 className="m-0 flex items-center gap-2 text-lg font-semibold text-ink">
          <CheckCircle2 className="w-5 h-5 text-run-fg" />
          {project.name} is on the board
        </h2>
        <p className="m-0 text-log-sm font-mono text-ink-4 break-all">{project.path}</p>
      </div>

      <p className="m-0 text-log-ui text-ink-3">
        {count === undefined
          ? 'Looking for OpenCode sessions in this folder…'
          : count === 0
            ? 'OpenCode has no sessions in this folder yet, so there is nothing to bring over.'
            : `OpenCode has ${count} session${count === 1 ? '' : 's'} in this folder. Pick the ones you want as cards, or start with an empty board.`}
      </p>

      <div className="flex flex-wrap justify-center gap-2">
        {count !== 0 && (
          <Button
            variant="primary"
            size="md"
            disabled={count === undefined}
            onClick={onImport}
            leftSection={<History className="w-4 h-4" />}
          >
            Import sessions…
          </Button>
        )}
        <Button variant={count === 0 ? 'primary' : 'secondary'} size="md" onClick={onSkip}>
          {count === 0 ? 'Open the board' : 'Start with an empty board'}
        </Button>
      </div>
    </div>
  );
};
