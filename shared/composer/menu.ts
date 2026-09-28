/**
 * What the composer's trigger menu offers, and what picking a row writes.
 *
 * The rows come from three places at once — the agent's commands, the repo's
 * files, and the tickets and PRs the user is on — so the ordering and the
 * insertion are worked out here, away from the box that renders them.
 */

import { FileItem, MentionItem, fileMention, mentionLink, mentionRef } from '../trackers/mentions.js';
import { SlashCommand, filterSlashCommands, insertSlashCommand } from './slashCommands.js';
import { Trigger, replaceTrigger } from './triggers.js';

/** One menu row: a command or skill from `/`, or a file, ticket or PR from `@`. */
export type ComposerMenuEntry =
  | { kind: 'command'; id: string; command: SlashCommand }
  | { kind: 'file'; id: string; file: FileItem }
  | { kind: 'mention'; id: string; mention: MentionItem };

/**
 * How many files a query may contribute. The repo has thousands and the
 * tickets have to stay reachable without scrolling past all of them.
 */
export const MENU_FILE_LIMIT = 10;

/** `@WEB-53` or `@web-app#94` is after a ticket, not a file. */
export function looksLikeTicket(query: string): boolean {
  return query.includes('#') || /^[A-Za-z][A-Za-z0-9]*-\d*$/.test(query);
}

export interface MenuSources {
  kind: 'slash' | 'at';
  query: string;
  commands: SlashCommand[];
  files: FileItem[];
  mentions: MentionItem[];
  fileLimit?: number;
}

/**
 * The rows for one open menu. `/` is commands alone; `@` mixes files with
 * tickets and PRs, and whichever the query reads like goes on top — a query
 * shaped like a ticket key is never a filename anyone is looking for.
 */
export function composerMenuEntries(sources: MenuSources): ComposerMenuEntry[] {
  if (sources.kind === 'slash') {
    return filterSlashCommands(sources.commands, sources.query).map((command) => ({
      kind: 'command' as const,
      id: `command:${command.id}`,
      command
    }));
  }

  const files = sources.files.slice(0, sources.fileLimit ?? MENU_FILE_LIMIT).map((file) => ({
    kind: 'file' as const,
    id: `file:${file.path}`,
    file
  }));
  const mentions = sources.mentions.map((mention) => ({
    kind: 'mention' as const,
    id: mentionRef(mention),
    mention
  }));
  return looksLikeTicket(sources.query) ? [...mentions, ...files] : [...files, ...mentions];
}

/**
 * The text that replaces the `/query` or `@query` token. Null when the row
 * inserts nothing — a disabled command is listed so it can be seen, not run.
 */
export function applyMenuEntry(
  entry: ComposerMenuEntry,
  text: string,
  trigger: Trigger,
  cursor: number
): { text: string; cursor: number } | null {
  if (entry.kind === 'command') {
    if (entry.command.disabled || !entry.command.insert) return null;
    return insertSlashCommand(text, trigger, cursor, entry.command);
  }
  const insertion = entry.kind === 'file' ? fileMention(entry.file) : mentionLink(entry.mention);
  return replaceTrigger(text, trigger, cursor, `${insertion} `);
}

/** What an empty menu says, which depends on what it was even able to search. */
export function composerMenuHint(kind: 'slash' | 'at', hasCwd: boolean): string {
  if (kind === 'slash') return 'No command or skill matches';
  return hasCwd
    ? 'No file, assigned ticket, or open PR matches'
    : 'No assigned ticket or open PR matches';
}

/** Arrow-key movement through the rows, wrapping at both ends. */
export function moveMenuActive(active: number, length: number, delta: number): number {
  if (length <= 0) return 0;
  return (active + delta + length) % length;
}
