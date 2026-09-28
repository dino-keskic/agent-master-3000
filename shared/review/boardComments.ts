/**
 * Cross-board review notes aggregation.
 *
 * Each task holds its own changelog comments on its diffs. This module collects
 * and categorizes them across every board task so they can be viewed, filtered,
 * and acted on in one place.
 */

import { BoardTask, ChangelogComment } from '../types.js';
import { commentLocation } from './changelogComments.js';

export type BoardCommentStatus = 'open' | 'resolved' | 'waiting_agent';

export interface BoardCommentItem {
  comment: ChangelogComment;
  taskId: string;
  taskTitle: string;
  location: string;
  status: BoardCommentStatus;
}

export interface BoardCommentCounts {
  total: number;
  open: number;
  resolved: number;
  waitingAgent: number;
}

function classifyCommentStatus(comment: ChangelogComment): BoardCommentStatus {
  if (comment.resolvedAt) return 'resolved';
  // If the last reply is from the user, it is waiting on the agent to address it.
  const lastReply = comment.replies[comment.replies.length - 1];
  if (lastReply) {
    return lastReply.author === 'user' ? 'waiting_agent' : 'open';
  }
  return comment.author === 'user' ? 'waiting_agent' : 'open';
}

/**
 * Collect all changelog review notes across all board tasks, newest first.
 */
export function collectBoardComments(tasks: BoardTask[]): BoardCommentItem[] {
  const result: BoardCommentItem[] = [];

  for (const task of tasks) {
    if (!task.changelogComments || task.changelogComments.length === 0) continue;
    for (const comment of task.changelogComments) {
      result.push({
        comment,
        taskId: task.id,
        taskTitle: task.title,
        location: commentLocation(comment),
        status: classifyCommentStatus(comment)
      });
    }
  }

  return result.sort((a, b) => b.comment.createdAt - a.comment.createdAt);
}

export function countBoardComments(items: BoardCommentItem[]): BoardCommentCounts {
  let open = 0;
  let resolved = 0;
  let waitingAgent = 0;

  for (const item of items) {
    if (item.status === 'resolved') resolved++;
    else if (item.status === 'waiting_agent') waitingAgent++;
    else open++;
  }

  return {
    total: items.length,
    open: open + waitingAgent, // All non-resolved are open
    resolved,
    waitingAgent
  };
}
