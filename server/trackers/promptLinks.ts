/**
 * Putting the links a prompt carries on its task.
 *
 * Every prompt a person sends — the one a task is created with and every
 * follow-up — adds the URLs typed into it to the task's links (`linksInPrompt`
 * decides which), and the status loop is kicked so a pasted PR or CI run shows
 * where it stands without waiting for the next minute's pass.
 */

import { linksInPrompt } from '../../shared/task/promptLinks.js';
import { taskStore } from '../board/taskStore.js';
import { BoardPublisher } from '../live/publisher.js';
import { kickLinkStatusRefresh } from './linkStatus.js';
import { TaskLink } from '../../shared/types.js';

export function liftPromptLinks(taskId: string, prompt: string | undefined, publisher: BoardPublisher): void {
  const found = linksInPrompt(prompt || '');
  if (found.length === 0) return;
  const written = taskStore.addTaskLinks(taskId, found, 'prompt');
  if (!written || written.result.added.length + written.result.updated.length === 0) return;
  publisher.updated(written.task);
  kickLinkStatusRefresh();
}

/** A task that was born with links has statuses to go and get. */
export function refreshSeededLinks(links: TaskLink[] | undefined): void {
  if (links && links.length > 0) kickLinkStatusRefresh();
}
