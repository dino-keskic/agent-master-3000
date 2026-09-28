import React from 'react';
import { Group, Select } from '@mantine/core';
import { Folder } from 'lucide-react';
import { ProjectFolder } from '../../../shared/types';
import { NewSessionForm } from './useNewSessionForm';

/** Where a blank session runs: which project, and which of its worktrees. */

interface SessionProjectFieldsProps {
  form: NewSessionForm;
  projects: ProjectFolder[];
}

export const SessionProjectFields: React.FC<SessionProjectFieldsProps> = ({ form, projects }) => (
  <Group gap="xs" wrap="wrap">
    <Group gap={4} wrap="nowrap" className="flex-1 min-w-[160px]">
      <Folder className="w-3.5 h-3.5 text-ink-3 shrink-0" />
      <Select
        size="xs"
        label="Project"
        value={form.project?.id || ''}
        data={projects.map((p) => ({ value: p.id, label: p.name }))}
        onChange={(val) => val && form.chooseProject(val)}
        allowDeselect={false}
      />
    </Group>
    {form.worktrees.length > 0 && (
      <Select
        size="xs"
        label="Folder"
        className="flex-1 min-w-[180px]"
        value={form.cwd || form.projectPath}
        data={[
          { value: form.projectPath, label: form.project?.name || 'main' },
          ...form.worktrees
            .filter((w) => w.path !== form.projectPath)
            .map((w) => ({ value: w.path, label: w.path.split('/').pop() || w.path }))
        ]}
        onChange={(val) => val && form.setCwd(val)}
        allowDeselect={false}
        searchable
      />
    )}
  </Group>
);
