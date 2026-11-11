import { TaskLogItem } from '../types.js';
import { MANAGER_BRIEFING } from './briefing.js';

/**
 * The manager's conversation, as the person having it sees it.
 *
 * Its briefing is sent as the first turn, so it used to open the transcript as
 * a wall of instructions under "You" — words the user never typed. It is left
 * out here; everything they did say, and everything the manager answered, stays.
 */
export function managerTranscript(logs: TaskLogItem[]): TaskLogItem[] {
  const briefing = MANAGER_BRIEFING.trim();
  const shown = logs.filter((log) => !(log.type === 'user_say' && log.text.trim() === briefing));
  // The same array when there was nothing to drop, so a memo on it holds.
  return shown.length === logs.length ? logs : shown;
}
