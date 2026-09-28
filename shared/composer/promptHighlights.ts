/**
 * Which stretches of the composer's text are something other than prose: the
 * `/skill` a message starts with, `@file` mentions, and the `[PROJ-1 — …](url)`
 * links the `@` menu writes for tickets and PRs.
 *
 * The composer paints these behind its textarea, so the segments must add back
 * up to exactly the text — a single character lost or gained and every mark
 * after it sits under the wrong word.
 */

import { leadingSlashCommand } from './slashCommands.js';

export type PromptSegmentKind = 'plain' | 'command' | 'file' | 'link';

export interface PromptSegment {
  kind: PromptSegmentKind;
  text: string;
}

/** An `@path` after whitespace or at the start, or a whole Markdown link. */
const TOKEN = /(^|(?<=\s))@[^\s@]+|\[[^\]\n]+\]\([^)\s]+\)/g;

export function promptHighlights(text: string): PromptSegment[] {
  const segments: PromptSegment[] = [];
  let at = 0;
  const push = (kind: PromptSegmentKind, part: string) => {
    if (part) segments.push({ kind, text: part });
  };

  const command = leadingSlashCommand(text);
  if (command) {
    const start = text.indexOf('/');
    push('plain', text.slice(0, start));
    push('command', text.slice(start, start + 1 + command.name.length));
    at = start + 1 + command.name.length;
  }

  TOKEN.lastIndex = at;
  for (let match = TOKEN.exec(text); match; match = TOKEN.exec(text)) {
    push('plain', text.slice(at, match.index));
    push(match[0].startsWith('@') ? 'file' : 'link', match[0]);
    at = match.index + match[0].length;
  }
  push('plain', text.slice(at));
  return segments;
}
