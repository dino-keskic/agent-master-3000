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

interface TaskTargetBarProps {
  projects: ProjectFolder[];
  selectedProjectId?: string;
  projectPath?: string;
  worktree: WorktreeTarget;
  /** The branch name a new worktree would get, from what has been typed so far. */
  slugPreview?: string;
  onSelectProject: (project: ProjectFolder) => void;
  onPickProjectFolder: () => void;
}

export const TaskTargetBar: React.FC<TaskTargetBarProps> = ({
  projects,
  selectedProjectId,
  projectPath,
  worktree,
  slugPreview,
  onSelectProject,
  onPickProjectFolder
}) => (
  <Group gap="sm" wrap="wrap" align="center">
    <InlineSelect
      label="Project"
      icon={<Folder className="w-3.5 h-3.5" />}
      value={selectedProjectId}
      placeholder="Choose a project"
      options={[
        ...projects.map(p => ({ value: p.id, label: p.name, keywords: p.path })),
        { value: ADD_PROJECT, label: '+ Choose folder…' }
      ]}
      onChange={(val) => {
        if (val === ADD_PROJECT) return onPickProjectFolder();
        const picked = projects.find(p => p.id === val);
        if (picked) onSelectProject(picked);
      }}
      title={projectPath}
      searchable={projects.length > 8}
    />

    {projectPath && (
      <WorktreePicker worktree={worktree} projectPath={projectPath} slugPreview={slugPreview} />
    )}
  </Group>
);
