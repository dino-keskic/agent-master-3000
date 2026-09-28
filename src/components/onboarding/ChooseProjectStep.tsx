import React, { useState } from 'react';
import { FolderOpen, FolderPlus, History } from 'lucide-react';
import { ProjectSuggestion } from '../../../shared/setup/onboarding';
import { relativeTime } from '../../../shared/format';
import { Button } from '../ui/Button';
import { useProjectSuggestions } from './useProjectSuggestions';

/**
 * The first step: which folder the board works in.
 *
 * Folders OpenCode has already worked in come first, because for anyone who
 * has used it that is the answer in one click. The folder dialog and a pasted
 * path are there for everything else — the path mostly for a machine where
 * the server has no dialog to open.
 */

interface ChooseProjectStepProps {
  isPickingFolder: boolean;
  onPickFolder: () => unknown;
  onAddFolder: (name: string, folderPath: string) => Promise<unknown>;
}

export const ChooseProjectStep: React.FC<ChooseProjectStepProps> = ({ isPickingFolder, onPickFolder, onAddFolder }) => {
  const { suggestions, isLoading } = useProjectSuggestions();
  const [typed, setTyped] = useState('');
  const [adding, setAdding] = useState<string | null>(null);

  const add = async (name: string, folderPath: string) => {
    setAdding(folderPath);
    try {
      await onAddFolder(name, folderPath);
    } finally {
      setAdding(null);
    }
  };

  return (
    <div className="flex flex-col gap-5 w-full">
      <div className="flex flex-col gap-1.5 text-center">
        <h2 className="m-0 text-lg font-semibold text-ink">Pick a project to work on</h2>
        <p className="m-0 text-log-ui text-ink-3">
          Tasks run in its folder. You can add more projects later from the project menu.
        </p>
      </div>

      {(isLoading || suggestions.length > 0) && (
        <section className="flex flex-col gap-2">
          <h3 className="m-0 flex items-center gap-1.5 text-log-sm font-semibold uppercase tracking-wide text-ink-4">
            <History className="w-3.5 h-3.5" />
            Folders you have used with OpenCode
          </h3>
          {isLoading ? (
            <p className="m-0 text-log-ui text-ink-4">Looking for them…</p>
          ) : (
            <ul className="m-0 p-0 list-none flex flex-col rounded-lg border border-line bg-surface overflow-hidden">
              {suggestions.map((suggestion) => (
                <SuggestionRow
                  key={suggestion.path}
                  suggestion={suggestion}
                  adding={adding === suggestion.path}
                  disabled={adding !== null}
                  onAdd={() => void add(suggestion.name, suggestion.path)}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="flex flex-col gap-2">
        <Button
          variant={suggestions.length > 0 ? 'secondary' : 'primary'}
          size="md"
          className="justify-center"
          loading={isPickingFolder}
          onClick={() => void onPickFolder()}
          leftSection={<FolderOpen className="w-4 h-4" />}
        >
          Choose a folder…
        </Button>

        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const folderPath = typed.trim();
            // Kept on failure so a typo can be fixed; success moves to the next step.
            if (folderPath) void add('', folderPath);
          }}
        >
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="or paste a path, e.g. ~/code/my-app"
            aria-label="Project folder path"
            spellCheck={false}
            className="flex-1 min-w-0 h-8 px-3 rounded-lg border border-line bg-surface text-ink text-log-ui font-mono placeholder:text-ink-4 focus:outline-none focus:border-acc-bd"
          />
          <Button
            type="submit"
            size="md"
            disabled={!typed.trim() || adding !== null}
            loading={adding !== null && adding === typed.trim()}
            leftSection={<FolderPlus className="w-4 h-4" />}
          >
            Add
          </Button>
        </form>
      </div>
    </div>
  );
};

interface SuggestionRowProps {
  suggestion: ProjectSuggestion;
  adding: boolean;
  disabled: boolean;
  onAdd: () => void;
}

const SuggestionRow: React.FC<SuggestionRowProps> = ({ suggestion, adding, disabled, onAdd }) => (
  <li className="border-b border-line last:border-b-0">
    <button
      type="button"
      onClick={onAdd}
      disabled={disabled}
      title={suggestion.path}
      className="w-full flex items-center gap-3 px-3 py-2.5 text-left bg-transparent border-0 cursor-pointer hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="text-sm font-medium text-ink truncate">{suggestion.name}</span>
        <span className="text-log-sm font-mono text-ink-4 truncate" dir="rtl">
          <bdi>{suggestion.path}</bdi>
        </span>
      </div>
      <span className="shrink-0 text-log-sm text-ink-3 text-right">
        {suggestion.sessions} session{suggestion.sessions === 1 ? '' : 's'}
        <br />
        <span className="text-ink-4">{relativeTime(suggestion.lastActive)}</span>
      </span>
      <span className="shrink-0 text-log-ui font-medium text-accent">{adding ? 'Adding…' : 'Add'}</span>
    </button>
  </li>
);
