import React, { useMemo } from 'react';
import { Group, Loader, ScrollArea, Stack, Text } from '@mantine/core';
import { BoardTask, ChangelogComment } from '../../../shared/types';
import { commentsInWorkspace, orphanedComments } from '../../../shared/review/changelogComments';
import { workspaceCommentIndex } from '../../../shared/review/commentIndex';
import { workspaceTitle } from '../../../shared/task/workspaces';
import { ChangelogCommentThread } from '../notes/ChangelogCommentThread';
import { CommentIndex } from '../notes/CommentIndex';
import { DiffToolbar } from './DiffToolbar';
import { WorkspaceSection } from './WorkspaceSection';
import { useChangelogDrafts } from './useChangelogDrafts';
import { useCommentJump } from './useCommentJump';
import { useTaskDiff } from './useTaskDiff';

/**
 * The changes a task made, and the review notes on them.
 *
 * This is the diff *and* the conversation about it: the same tab shows what
 * changed and what has been said about each line, because the notes only mean
 * anything next to the code they point at. The pieces under `diff/` render the
 * levels — folder, file, hunk, line — and the hooks own the diff, the drafts
 * and getting to a note.
 *
 * A task is not one folder any more: its sessions can work in different
 * projects and different checkouts, so what is stacked here is one section per
 * folder, and a note is read against the folder it was written on.
 */

interface DiffViewProps {
  taskId: string;
  sessionId?: string;
  /** True while the session on screen has a turn in flight. */
  running?: boolean;
  comments?: ChangelogComment[];
  onApplyTask?: (task: BoardTask) => void;
  onOpenFile?: (path: string, line?: number, cwd?: string) => void;
}

export const DiffView: React.FC<DiffViewProps> = ({
  taskId,
  sessionId,
  running = false,
  comments = [],
  onApplyTask,
  onOpenFile
}) => {
  const view = useTaskDiff(taskId, sessionId, running, comments);
  const { drafts, threads } = useChangelogDrafts(taskId, view.expand, onApplyTask);
  const { focusedId, jumpTo } = useCommentJump(comments, view.expand, !view.loading && !!view.workspaces);

  const workspaces = view.workspaces;
  const readable = useMemo(
    () => (workspaces || []).filter((workspace) => !workspace.error),
    [workspaces]
  );

  // A note whose lines are no longer in any folder's diff still has to be
  // readable, or answering it would mean finding the commit it was written
  // against. It is an orphan only when no folder still has its line.
  const orphans = useMemo(() => {
    if (!workspaces) return [];
    if (readable.length === 0) return comments;
    const anchored = new Set<string>();
    for (const workspace of readable) {
      const scoped = commentsInWorkspace(comments, workspace.cwd);
      const lost = new Set(orphanedComments(scoped, workspace.files).map((comment) => comment.id));
      for (const comment of scoped) if (!lost.has(comment.id)) anchored.add(comment.id);
    }
    return comments.filter((comment) => !anchored.has(comment.id));
  }, [comments, workspaces, readable]);

  const index = useMemo(
    () =>
      workspaceCommentIndex(
        comments,
        (workspaces || []).map((workspace) => ({
          cwd: workspace.cwd,
          title: workspaceTitle(workspace),
          files: workspace.error ? [] : workspace.files
        }))
      ),
    [comments, workspaces]
  );

  const threadControls = { ...threads, focusedId };
  const alone = (workspaces || []).length < 2;
  const nothingAnywhere = !!workspaces && readable.length > 0
    && readable.every((workspace) => workspace.files.length === 0);
  const emptyLabel = (baseRef?: string) =>
    view.scope === 'uncommitted'
      ? 'No uncommitted changes in this folder.'
      : `Nothing on this branch that ${baseRef || 'the base'} does not already have.`;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <DiffToolbar
        scope={view.scope}
        workspaces={workspaces}
        onScope={view.pickScope}
        onReload={view.reload}
      />

      <ScrollArea className="flex-1 min-h-0">
        {view.loading ? (
          <Group justify="center" py="xl">
            <Loader size="sm" color="gray" />
          </Group>
        ) : !workspaces ? null : (
          <Stack gap={0} p="xs" className="pb-36">
            <CommentIndex entries={index} onJump={jumpTo} />

            {!nothingAnywhere && (
              <Text size="xs" c="dimmed" px="xs" pb="xs">
                Click a line number to comment.
                {index.length > 0 && (
                  <>
                    {' '}Type <span className="font-mono text-ink">/address comments</span> in the composer to send
                    every open note to the agent in one turn.
                  </>
                )}
              </Text>
            )}

            {orphans.length > 0 && (
              <div className="mb-2 rounded-lg border border-line/70 bg-canvas/40 px-2 py-2">
                <Text size="xs" className="font-mono text-ink-2 pb-1">
                  Comments not on the current diff
                </Text>
                {orphans.map((comment) => (
                  <ChangelogCommentThread
                    key={comment.id}
                    comment={comment}
                    showAnchor
                    {...threadControls}
                  />
                ))}
              </div>
            )}

            {workspaces.map((workspace) => (
              <WorkspaceSection
                key={workspace.cwd}
                workspace={workspace}
                comments={commentsInWorkspace(comments, workspace.cwd)}
                alone={alone}
                isCollapsed={view.isCollapsed}
                toggle={view.toggle}
                onOpenFile={onOpenFile}
                drafts={drafts}
                threads={threadControls}
                emptyLabel={emptyLabel(workspace.baseRef)}
              />
            ))}
          </Stack>
        )}
      </ScrollArea>
    </div>
  );
};
