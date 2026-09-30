/**
 * The links a prompt puts on its task.
 *
 * A prompt as it reaches the server is what the person typed plus the blocks
 * the composer fetched for the tickets, PRs and runs linked in it. Only the
 * typed part says what the work is about: a PR description or a CI log is full
 * of URLs nobody chose, and lifting those would bury the ones that were.
 */

import { splitMentionBlocks } from '../trackers/mentions.js';
import { extractLinks, NewTaskLink } from './links.js';

export function linksInPrompt(prompt: string): NewTaskLink[] {
  const typed = splitMentionBlocks(prompt || '')
    .flatMap((segment) => (segment.kind === 'text' ? [segment.text] : []))
    .join('\n');
  return extractLinks(typed);
}
