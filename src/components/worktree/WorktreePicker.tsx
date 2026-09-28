import React from 'react';
import { Badge, Checkbox, Group, Stack, Text, Tooltip } from '@mantine/core';
import { GitBranch } from 'lucide-react';
import { WorktreeEntry } from '../../../shared/git/worktree';
import { WorktreeTarget } from '../header/useWorktreeTarget';
import { InlineSelect } from '../ui/InlineSelect';

/**
 * Which checkout of a project the work runs in.
 *
 * A project folder is not necessarily one checkout, so this is the picker for
 * the rest: every worktree of the repo, plus the option of cutting a fresh one
 * on its own branch. The composer uses it to place a new task, and the drawer
 * to move work that already exists — the question is the same either way, so
 * the control is too.
 */

const folderName = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;

const branchOf = (entry: WorktreeEntry) => entry.branch || (entry.detached ? 'detached' : 'no branch');

const worktreeLabel = (entry: WorktreeEntry) => `${folderName(entry.path)} · ${branchOf(entry)}`;

interface WorktreePickerProps {
  worktree: WorktreeTarget;
  /** The project folder, which stands in for the checkout list when git has none. */
  projectPath?: string;
  /** The branch name a new worktree would get, from what is known of the work. */
  slugPreview?: string;
}

export const WorktreePicker: React.FC<WorktreePickerProps> = ({ worktree, projectPath, slugPreview }) => {
  const { checkouts, git, target, createNew } = worktree;
  const mainPath = git?.root;
  const current = target || projectPath;
  const listed = checkouts.map((w) => ({ value: w.path, label: worktreeLabel(w), keywords: w.path }));
  // Before git answers — or when the folder is not a listed checkout — the
  // folder itself is the one choice, so the picker names it rather than
  // reading as a missing value.
  const options =
    current && !listed.some((o) => o.value === current)
      ? [...listed, { value: current, label: folderName(current), keywords: current }]
      : listed;

  return (
    <Group gap="sm" wrap="nowrap" className="min-w-0">
      {createNew ? (
        <Tooltip label={`Cuts a new git worktree${slugPreview ? ` (${slugPreview})` : ''} — isolated checkout`} withArrow>
          <Group gap={6} wrap="nowrap" className="min-w-0 h-7 px-1">
            <GitBranch className="w-3.5 h-3.5 text-ink-3 shrink-0" />
            <Text size="xs" className="font-mono text-[11.5px] text-acc-fg truncate">
              {slugPreview || 'new-worktree'}
            </Text>
          </Group>
        </Tooltip>
      ) : (
        <InlineSelect
          label="Worktree"
          icon={<GitBranch className="w-3.5 h-3.5" />}
          value={current}
          options={options}
          onChange={worktree.setTarget}
          title={`Runs in ${current}`}
          searchable={options.length > 6}
          renderOption={(option) => {
            const entry = checkouts.find((w) => w.path === option.value);
            const isMain = entry ? entry.path === mainPath : option.value === projectPath;
            return (
              <Stack gap={0} className="py-0.5 min-w-0">
                <Group gap={6} wrap="nowrap">
                  <Text size="xs" fw={600} className="truncate">
                    {folderName(option.value)}
                  </Text>
                  {isMain && (
                    <Badge size="xs" variant="light" color="gray" className="font-mono">
                      main
                    </Badge>
                  )}
                </Group>
                {entry && (
                  <Text size="10px" c="dimmed" className="font-mono truncate">
                    {branchOf(entry)}
                  </Text>
                )}
              </Stack>
            );
          }}
        />
      )}
      {git?.isRepo && (
        <Checkbox
          size="xs"
          checked={createNew}
          onChange={(e) => worktree.setCreateNew(e.currentTarget.checked)}
          label="New worktree"
          classNames={{ label: 'composer-check-label', body: 'composer-check' }}
        />
      )}
    </Group>
  );
};
