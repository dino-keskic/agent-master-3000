/**
 * Writing to a task's links.
 *
 * `links.ts` decides what a link is and how two of them merge; this puts
 * the result on the task and reports whether anything changed.
 */

import { newId } from '../ids.js';
import {
  buildTaskLink,
  MAX_LINK_NOTE,
  MAX_LINK_TITLE,
  mergeTaskLinks,
  NewTaskLink,
  TaskLinkMergeResult
} from './links.js';
import { BoardTask, TaskLink, TaskLinkSource } from '../types.js';

export interface TaskLinkWriteResult {
  result: TaskLinkMergeResult;
  /** URLs that were not links at all. */
  rejected: string[];
}

export function addTaskLinks(
  task: BoardTask,
  inputs: NewTaskLink[],
  source: TaskLinkSource,
  now = Date.now()
): TaskLinkWriteResult {
  const rejected: string[] = [];
  const built: TaskLink[] = [];
  for (const input of inputs) {
    const link = buildTaskLink(input, newId(), source, now);
    if (link) built.push(link);
    else rejected.push(input.url);
  }

  const result = mergeTaskLinks(task.links, built);
  if (result.added.length > 0 || result.updated.length > 0) {
    task.links = result.links;
    task.updatedAt = now;
  }
  return { result, rejected };
}

/** An empty title is ignored; an empty note clears it. */
export function patchTaskLink(
  task: BoardTask,
  linkId: string,
  patch: { title?: string; note?: string }
): boolean {
  const link = task.links?.find((item) => item.id === linkId);
  if (!link) return false;
  if (typeof patch.title === 'string') {
    const title = patch.title.replace(/\s+/g, ' ').trim().slice(0, MAX_LINK_TITLE);
    if (title) link.title = title;
  }
  if (typeof patch.note === 'string') {
    const note = patch.note.replace(/\s+/g, ' ').trim().slice(0, MAX_LINK_NOTE);
    if (note) link.note = note;
    else delete link.note;
  }
  link.updatedAt = Date.now();
  task.updatedAt = link.updatedAt;
  return true;
}

export function removeTaskLink(task: BoardTask, linkId: string): boolean {
  const index = task.links?.findIndex((item) => item.id === linkId) ?? -1;
  if (!task.links || index < 0) return false;
  task.links.splice(index, 1);
  task.updatedAt = Date.now();
  return true;
}
