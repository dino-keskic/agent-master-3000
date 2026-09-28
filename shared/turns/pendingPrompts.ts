import { PromptImage, QueuedTurn, TaskLogItem, TaskRunState } from '../types.js';

/**
 * Prompts the user has sent that the transcript does not show yet.
 *
 * The server writes a prompt into the transcript only once the agent has the
 * session open and configured, and a session that is not loaded yet can take
 * seconds to get there. Until then the drawer shows the message itself, with a
 * note that the agent is warming up, instead of an empty screen after Enter.
 *
 * A pending prompt is settled — dropped — by whatever tells the user where it
 * went: its echo in the transcript, its row in the queue, or the end of a run
 * that never echoed it (the start failed, or was stopped).
 */

export interface PendingPrompt {
  id: string;
  /** The session it was sent to, when one was on screen. */
  sessionId?: string;
  text: string;
  images?: PromptImage[];
  sentAt: number;
  /** Echoes of this same text already in the transcript when it was sent. */
  echoesBefore: number;
  /** Seen the session running since it was sent, so its next idle is the end. */
  started?: boolean;
}

/** What the drawer can see of the session a prompt went to. */
export interface PendingObservation {
  sessionId?: string;
  logs: TaskLogItem[];
  queued: QueuedTurn[];
  runState: TaskRunState | undefined;
}

/**
 * A prompt sent before the task had any session goes to the one its turn
 * creates, whichever id that turns out to be.
 */
function belongsTo(prompt: PendingPrompt, sessionId: string | undefined): boolean {
  return !prompt.sessionId || prompt.sessionId === sessionId;
}

function echoCount(logs: TaskLogItem[], text: string): number {
  let count = 0;
  for (const log of logs) if (log.type === 'user_say' && (log.text || '').trim() === text) count += 1;
  return count;
}

export function pendingPrompt(
  id: string,
  text: string,
  images: PromptImage[] | undefined,
  observed: Pick<PendingObservation, 'sessionId' | 'logs'>,
  now: number
): PendingPrompt {
  const trimmed = text.trim();
  return {
    id,
    sessionId: observed.sessionId,
    text: trimmed,
    images: images?.length ? images : undefined,
    sentAt: now,
    echoesBefore: echoCount(observed.logs, trimmed)
  };
}

/**
 * The prompts still waiting after what the session now shows. Prompts sent to
 * another session are left alone: this observation says nothing about them.
 *
 * Returns the same array when nothing changed, so a caller can adjust state
 * with it during render and still terminate.
 */
export function settlePendingPrompts(pending: PendingPrompt[], observed: PendingObservation): PendingPrompt[] {
  if (pending.length === 0) return pending;
  let changed = false;
  const next: PendingPrompt[] = [];
  for (const prompt of pending) {
    if (!belongsTo(prompt, observed.sessionId)) {
      next.push(prompt);
      continue;
    }
    const echoed = echoCount(observed.logs, prompt.text) > prompt.echoesBefore;
    const queued = observed.queued.some((turn) => (turn.prompt || '').trim() === prompt.text);
    const running = observed.runState === 'running' || observed.runState === 'awaiting_input';
    if (echoed || queued || (prompt.started && !running)) {
      changed = true;
      continue;
    }
    if (running && !prompt.started) {
      changed = true;
      next.push({ ...prompt, started: true });
      continue;
    }
    next.push(prompt);
  }
  return changed ? next : pending;
}

/** The prompts to draw under this session's transcript. */
export function pendingFor(pending: PendingPrompt[], sessionId: string | undefined): PendingPrompt[] {
  return pending.filter((prompt) => belongsTo(prompt, sessionId));
}

/** A pending prompt drawn as the transcript will draw its echo. */
export function pendingAsLog(prompt: PendingPrompt): TaskLogItem {
  return {
    id: `pending-${prompt.id}`,
    timestamp: prompt.sentAt,
    type: 'user_say',
    title: 'User Prompt',
    text: prompt.text,
    images: prompt.images,
    sessionId: prompt.sessionId
  };
}

/**
 * The line under the transcript while nothing else says the agent is on it:
 * "warming up" until the prompt is echoed, then "thinking" until the agent
 * produces its first output.
 */
export type StreamActivity = 'warming' | 'thinking' | undefined;

export function streamActivity(
  pendingCount: number,
  runState: TaskRunState | undefined,
  lastLog: TaskLogItem | undefined
): StreamActivity {
  if (pendingCount > 0) return 'warming';
  if (runState !== 'running') return undefined;
  return lastLog?.type === 'user_say' ? 'thinking' : undefined;
}
