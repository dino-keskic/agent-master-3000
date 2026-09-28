/**
 * Writing to a task's changelog threads.
 *
 * `changelogComments.ts` decides what a comment *is* — this decides what
 * happens to the task when one is added, replied to, resolved or removed. Each
 * function reports whether the task actually changed, so the store knows when
 * a save is worth doing.
 */

import { newId } from '../ids.js';
import { ChangelogResponse, ChangelogResponseResult } from './agentResponses.js';
import { buildChangelogComment, buildChangelogReply, NewChangelogComment } from './changelogComments.js';
import { BoardTask, ChangelogAuthor } from '../types.js';

export function appendChangelogComment(task: BoardTask, input: NewChangelogComment): boolean {
  const comment = buildChangelogComment(input, newId());
  if (!comment) return false;
  if (!task.changelogComments) task.changelogComments = [];
  task.changelogComments.push(comment);
  task.updatedAt = Date.now();
  return true;
}

/**
 * Apply replies and resolutions in one pass, so a batch from the agent either
 * lands together or reports exactly which ids it could not find.
 */
export function applyChangelogResponses(
  task: BoardTask,
  responses: ChangelogResponse[],
  author: ChangelogAuthor,
  now = Date.now()
): ChangelogResponseResult {
  const result: ChangelogResponseResult = { applied: [], missing: [] };
  for (const response of responses) {
    const comment = task.changelogComments?.find((item) => item.id === response.commentId);
    if (!comment) {
      result.missing.push(response.commentId);
      continue;
    }
    const reply = response.reply ? buildChangelogReply(response.reply, author, newId(), now) : null;
    if (reply) comment.replies.push(reply);
    if (response.status === 'resolved') comment.resolvedAt = now;
    else if (response.status === 'open') delete comment.resolvedAt;
    result.applied.push({ commentId: comment.id, replied: !!reply, status: response.status });
  }
  if (result.applied.length > 0) task.updatedAt = now;
  return result;
}

export function removeChangelogComment(task: BoardTask, commentId: string): boolean {
  const index = task.changelogComments?.findIndex((item) => item.id === commentId) ?? -1;
  if (!task.changelogComments || index < 0) return false;
  task.changelogComments.splice(index, 1);
  task.updatedAt = Date.now();
  return true;
}
