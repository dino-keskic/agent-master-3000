import React from 'react';
import { Group } from '@mantine/core';
import { Folder } from 'lucide-react';
import { ProjectFolder } from '../../../shared/types';
import { InlineSelect } from '../ui/InlineSelect';
import { WorktreePicker } from '../worktree/WorktreePicker';
import { WorktreeTarget } from './useWorktreeTarget';

/**
 * Where the next task runs: which project, and which checkout of it.
 *
 * Both are shown as bare text until clicked, because they are read far more
 * often than they are changed — the row says where you are, and only turns into
 * a picker when you want to be somewhere else.
 */

/** The picker's own entry for adding a folder the board does not know yet. */
const ADD_PROJECT = '__ADD_NEW__';
/** …and for taking the chosen one off the board (its folder is left alone). */
const REMOVE_PROJECT = '__REMOVE__';

interface TaskTargetBarProps {
  projects: ProjectFolder[];
  selectedProjectId?: string;
  projectPath?: string;
  worktree: WorktreeTarget;
  /** The branch name a new worktree would get, from what has been typed so far. */
  slugPreview?: string;
  /** The pull request the typed text links to, whose branch a new worktree would use. */
  pullRequest?: { repo: string; number: number };
  onSelectProject: (project: ProjectFolder) => void;
  onPickProjectFolder: () => void;
  onDeleteProject?: (projectId: string) => void;
}

export const TaskTargetBar: React.FC<TaskTargetBarProps> = ({
  projects,
  selectedProjectId,
  projectPath,
  worktree,
  slugPreview,
  pullRequest,
  onSelectProject,
  onPickProjectFolder,
  onDeleteProject
}) => {
  const selected = projects.find(p => p.id === selectedProjectId);
  return (
  <Group gap="sm" wrap="wrap" align="center">
    <InlineSelect
      label="Project"
      icon={<Folder className="w-3.5 h-3.5" />}
      value={selectedProjectId}
      placeholder="Choose a project"
      options={[
        ...projects.map(p => ({ value: p.id, label: p.name, keywords: p.path })),
        { value: ADD_PROJECT, label: '+ Choose folder…' },
        ...(selected && onDeleteProject ? [{ value: REMOVE_PROJECT, label: `− Remove ${selected.name} from board` }] : [])
      ]}
      onChange={(val) => {
        if (val === ADD_PROJECT) return onPickProjectFolder();
        if (val === REMOVE_PROJECT) {
          if (selected && window.confirm(`Remove ${selected.name} from the board? Its folder and tasks are not touched.`)) {
            onDeleteProject?.(selected.id);
          }
          return;
        }
        const picked = projects.find(p => p.id === val);
        if (picked) onSelectProject(picked);
      }}
      title={projectPath}
      searchable={projects.length > 8}
    />

    {projectPath && (
      <WorktreePicker worktree={worktree} projectPath={projectPath} slugPreview={slugPreview} pullRequest={pullRequest} />
    )}
  </Group>
  );
};
