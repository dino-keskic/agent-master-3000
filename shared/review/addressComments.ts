/**
 * `/address comments`: the open notes on a task, written out as a prompt the
 * agent can work through and answer with the changelog tools.
 */

import { ChangelogAuthor, ChangelogComment } from '../types.js';
import { SlashCommand } from '../composer/slashCommands.js';
import { commentLocation, openChangelogComments } from './changelogComments.js';

function authorLabel(author: ChangelogAuthor): string {
  return author === 'agent' ? 'Agent' : 'You';
}

/**
 * @param withFolder prefix the file with the folder it is in. A task can work
 *   in two repositories that both have a `src/index.ts`, and the agent has no
 *   way to tell those notes apart from the path alone.
 */
function formatThread(comment: ChangelogComment, withFolder = false): string {
  const loc = withFolder && comment.cwd
    ? `${comment.cwd}/${commentLocation(comment)}`
    : commentLocation(comment);
  const snippet = comment.snippet.trim()
    ? `\`\`\`\n${comment.snippet.trimEnd()}\n\`\`\`\n`
    : '';
  const replies = comment.replies
    .map((reply) => `${authorLabel(reply.author)}: ${reply.body}`)
    .join('\n');
  return [
    `### ${loc} · \`${comment.id}\``,
    snippet + `${authorLabel(comment.author)}: ${comment.body}`,
    replies
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Prompt inserted by `/address comments`. Includes ids so the agent can reply
 * through the changelog tools without re-deriving which note is which, and
 * points at the batch tool so N notes do not cost N turns.
 */
export function formatAddressCommentsPrompt(comments: ChangelogComment[] | undefined): string {
  const open = openChangelogComments(comments);
  if (open.length === 0) return '';
  const plural = open.length === 1 ? 'this changelog comment' : `these ${open.length} changelog comments`;
  // Folders are worth naming only when the notes are actually spread over more
  // than one; on the ordinary single-folder task they would be noise.
  const spread = new Set(open.map((comment) => comment.cwd || '')).size > 1;
  return [
    `Address ${plural}. They are local review notes on this task's changes — not GitHub comments.`,
    '',
    'When you are done, call `respond_to_changelog_comments` **once** with one entry per comment —'
      + ' it takes a list, so reply to and resolve all of them in a single call rather than one call each.',
    '',
    ...open.map((comment) => formatThread(comment, spread))
  ].join('\n');
}

export function addressCommentsCommand(comments: ChangelogComment[] | undefined): SlashCommand {
  const open = openChangelogComments(comments);
  const count = open.length;
  return {
    id: 'address-comments',
    label: 'address comments',
    kind: 'command',
    source: 'board',
    description: count
      ? `Attach ${count} open changelog comment${count === 1 ? '' : 's'} to this turn`
      : 'No open changelog comments on this task',
    disabled: count === 0,
    insert: formatAddressCommentsPrompt(open)
  };
}

export function changelogSlashCommands(comments: ChangelogComment[] | undefined): SlashCommand[] {
  return [addressCommentsCommand(comments)];
}
