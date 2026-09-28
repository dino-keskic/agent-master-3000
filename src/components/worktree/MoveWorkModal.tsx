import React, { useState } from 'react';
import { Group, Modal, Select, Stack, Text } from '@mantine/core';
import { BoardTask, ProjectFolder } from '../../../shared/types';
import { projectOwning } from '../../../shared/board/projectPaths';
import { worktreeName } from '../../../shared/git/worktree';
import { taskTicket } from '../../../shared/task/links';
import { TaskSessionView, sessionCwd } from '../../../shared/task/sessions';
import { MoveTargetInput } from '../../api';
import { useWorktreeTarget } from '../header/useWorktreeTarget';
import { Button } from '../ui';
import { WorktreePicker } from './WorktreePicker';

/**
 * Move work that already exists: a task, or one session of it.
 *
 * A project is a folder, and a folder is not one checkout — so the question is
 * the same one the composer asks before starting a task, and it is asked with
 * the same controls. Moving a session leaves the task where it is; moving the
 * task takes the sessions that follow it along.
 */

/** The picker's row for leaving the list, which means different things here. */
const DETACH = '__DETACH__';

interface MoveWorkModalProps {
  task: BoardTask;
  /** The session to move. Absent moves the task itself. */
  session?: TaskSessionView;
  projects: ProjectFolder[];
  opened: boolean;
  onClose: () => void;
  /** Resolves false when the board refused the move, which keeps this open. */
  onMove: (sessionId: string | undefined, target: MoveTargetInput) => Promise<boolean>;
}

export const MoveWorkModal: React.FC<MoveWorkModalProps> = ({
  task,
  session,
  projects,
  opened,
  onClose,
  onMove
}) => {
  const currentCwd = session ? sessionCwd(task, session) : task.cwd;
  const current = projectOwning(projects, session ? session.projectId : task.projectId, currentCwd);
  const [projectId, setProjectId] = useState<string>(current?.id || DETACH);
  const [busy, setBusy] = useState(false);
  const project = projects.find((p) => p.id === projectId);
  const worktree = useWorktreeTarget(project?.path, task.cwd, currentCwd);

  // A session with nothing of its own to say about where it runs already
  // follows the task, and a task in no project has no tag left to drop.
  const detachable = session ? !!session.cwd || !!session.projectId : !!task.projectId;
  const detaching = projectId === DETACH;

  const submit = async () => {
    setBusy(true);
    try {
      const target: MoveTargetInput = detaching
        ? {}
        : { projectId, cwd: (await worktree.resolveCwd(task.title, task.id)).cwd };
      if (await onMove(session?.sessionId, target)) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={session ? `Move "${session.title || 'session'}"` : `Move ${task.id}`}
      centered
      size="lg"
    >
      <Stack gap="md">
        <Text size="xs" c="dimmed">
          {session
            ? 'Only this session moves; the task stays where it is. A turn already running keeps the folder it started in.'
            : 'The task and every session that follows it move together.'}
        </Text>

        <Select
          size="xs"
          label="Project"
          value={projectId}
          data={[
            ...projects.map((p) => ({ value: p.id, label: `${p.name} — ${p.path}` })),
            ...(detachable
              ? [{ value: DETACH, label: session ? "Follow the task's project" : 'No project' }]
              : [])
          ]}
          onChange={(val) => val && setProjectId(val)}
          allowDeselect={false}
          searchable
        />

        {!detaching && project && (
          <Stack gap={4}>
            <Text size="xs" className="text-ink-3">Worktree</Text>
            <WorktreePicker worktree={worktree} projectPath={project.path} slugPreview={worktreeName(taskTicket(task.links), task.title)} />
          </Stack>
        )}

        <Group justify="flex-end" gap="xs">
          <Button size="sm" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Moving…' : 'Move'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};
