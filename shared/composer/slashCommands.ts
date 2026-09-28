/**
 * What `/` offers: board commands, the agent's own commands, and its skills.
 * Tickets, PRs and files moved to `@` — see `shared/trackers/mentions.ts`.
 */

import { Trigger, replaceTrigger } from './triggers.js';

export type SlashKind = 'command' | 'skill';

export interface SlashCommand {
  id: string;
  /** What the menu shows after `/`, e.g. `address comments`. */
  label: string;
  description: string;
  /** Commands run; skills are capabilities the agent can reach for. */
  kind?: SlashKind;
  /** Where it came from — used for the menu section and the row hint. */
  source?: 'board' | 'project' | 'global' | 'builtin';
  /** When true the row is visible but picking it does nothing. */
  disabled?: boolean;
  /** Replaces the `/query` token in the composer. Empty when disabled. */
  insert: string;
}

export function insertSlashCommand(
  text: string,
  trigger: Trigger,
  cursor: number,
  command: SlashCommand
): { text: string; cursor: number } {
  return replaceTrigger(text, trigger, cursor, command.insert);
}

export function filterSlashCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  const needle = query.trim().toLowerCase().replace(/[/_-]+/g, ' ');
  if (!needle) return commands;
  return commands.filter((command) => {
    const hay = `${command.id} ${command.label} ${command.description}`.toLowerCase().replace(/[/_-]+/g, ' ');
    return hay.includes(needle);
  });
}

/**
 * Board commands first — they act on what is on screen — then the agent's own
 * commands, then its skills. Within a group, project beats global so a repo's
 * own version of a name is the one you reach first.
 */
const GROUP_RANK: Record<string, number> = { board: 0, builtin: 1, project: 2, global: 3 };

export function sortSlashCommands(commands: SlashCommand[]): SlashCommand[] {
  const rank = (command: SlashCommand) =>
    (command.kind === 'skill' ? 100 : 0) + (GROUP_RANK[command.source || 'board'] ?? 9);
  return [...commands].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}

/** Drops a later duplicate of a name, so a project command shadows a global one. */
export function dedupeSlashCommands(commands: SlashCommand[]): SlashCommand[] {
  const seen = new Set<string>();
  return commands.filter((command) => {
    const key = `${command.kind || 'command'}:${command.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type { Trigger as SlashTrigger };
export { slashTrigger, replaceTrigger } from './triggers.js';

/**
 * The command or skill a message was sent with: a `/name` at the very start,
 * which is how the `/` menu inserts one and how the agent reads it. Only the
 * start counts — `/` mid-sentence is prose, and a path like `/Users/me` is not
 * a command because the name must end at whitespace.
 */
export function leadingSlashCommand(text: string): { name: string; rest: string } | null {
  const match = /^\s*\/([A-Za-z][\w.:-]*)(?=\s|$)/.exec(text);
  if (!match) return null;
  return { name: match[1]!, rest: text.slice(match[0].length).replace(/^[ \t]+/, '') };
}
