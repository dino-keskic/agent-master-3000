import { PendingRequest, PromptImage, TaskLogItem, TaskLogType } from '../../shared/types.js';
import { newId } from '../../shared/ids.js';

/** Something the agent did that the board needs to know about. */
export interface AcpEvent {
  type: 'log' | 'status_change' | 'error' | 'session_bound' | 'awaiting_input' | 'session_info';
  log?: TaskLogItem;
  error?: string;
  /**
   * The session the event came from. Sessions of one task run concurrently, so
   * the server needs this to know *which* of them finished, broke, or blocked —
   * a task id alone would collapse them all into one state.
   */
  sessionId?: string;
  /** Set on 'session_bound': this session is the task's primary one. */
  primary?: boolean;
  /** Set on 'awaiting_input': the agent is blocked until the user answers. */
  request?: PendingRequest;
  /** Set on 'session_info': OpenCode renamed the session. */
  title?: string;
}

export type AcpEventCallback = (taskId: string, event: AcpEvent) => void;

/** A log line, with the id and timestamp every one of them needs. */
export function note(type: TaskLogType, title: string, text: string, sessionId?: string): TaskLogItem {
  return { id: newId(), timestamp: Date.now(), type, title, text, sessionId };
}

/**
 * The builders below exist so the manager's turn code reads as a sequence of
 * decisions rather than a wall of object literals, and so the exact wording the
 * user sees is in one file instead of scattered across three hundred lines.
 */

export function sessionBound(sessionId: string, primary: boolean): AcpEvent {
  return { type: 'session_bound', sessionId, primary };
}

export function configWarning(text: string): AcpEvent {
  return { type: 'log', log: note('error', 'Configuration Warning', text) };
}

export function configInfo(text: string): AcpEvent {
  return { type: 'log', log: note('info', 'Session', text) };
}

export function autoApproved(toolName: string, mode: string): AcpEvent {
  return {
    type: 'log',
    log: note('info', 'Permission auto-approved', `${toolName} was approved automatically (${mode}).`)
  };
}

/**
 * Echo of the prompt the board is about to send, so the transcript shows it.
 * Images travel as references: the transcript renders them from the board's
 * own attachment store rather than holding the bytes.
 */
export function promptEcho(
  sessionId: string,
  title: string,
  text: string,
  images: PromptImage[] = []
): AcpEvent {
  const log = note('user_say', title, text, sessionId);
  if (images.length > 0) log.images = images;
  return { type: 'log', sessionId, log };
}

/**
 * A turn ended, but a stop or a newer turn already claimed the session — so
 * only the run state is refreshed, and whoever superseded it writes the story.
 */
export function turnSuperseded(sessionId: string): AcpEvent {
  return { type: 'status_change', sessionId };
}

/** The user sent a queued prompt now, cutting off the turn it was waiting on. */
export function turnInterrupted(sessionId: string): TaskLogItem {
  return note('info', 'Turn Interrupted', 'Turn interrupted to send a queued prompt now.', sessionId);
}

export function turnFinished(sessionId: string, stopReason: string): AcpEvent {
  if (stopReason === 'cancelled') {
    return {
      type: 'status_change',
      sessionId,
      log: note('info', 'Turn Cancelled', 'Turn cancelled. Session kept — send a follow-up to continue.', sessionId)
    };
  }
  const text = stopReason === 'end_turn' ? 'Agent finished this turn.' : `Turn ended (${stopReason}).`;
  return { type: 'status_change', sessionId, log: note('info', 'Turn Complete', text, sessionId) };
}

export function turnFailed(sessionId: string, message: string): AcpEvent {
  return {
    type: 'error',
    sessionId,
    error: message,
    log: note('error', 'Execution Error', `Agent encountered error: ${message}`, sessionId)
  };
}

export function compactStarted(sessionId: string, command: string): AcpEvent {
  return {
    type: 'log',
    sessionId,
    log: note('info', 'Compacting session', `Asked OpenCode to summarize this conversation (${command}).`, sessionId)
  };
}

export function compactFinished(sessionId: string, stopReason: string): AcpEvent {
  const ended = stopReason === 'end_turn';
  return {
    type: 'status_change',
    sessionId,
    log: note(
      'info',
      ended ? 'Session compacted' : 'Compact ended',
      ended
        ? 'The conversation was replaced by the summary above. Follow-ups continue from there.'
        : `Compact ended (${stopReason}).`,
      sessionId
    )
  };
}

export function compactFailed(sessionId: string, error: unknown): AcpEvent {
  const message = (error as { message?: string } | undefined)?.message;
  return {
    type: 'error',
    sessionId,
    error: message,
    log: note('error', 'Compact Failed', `Could not compact this session: ${message || String(error)}`, sessionId)
  };
}

/**
 * What the transcript calls the prompt about to be sent. A side chat is marked
 * so it reads as an aside, and a bare resume is not dressed up as a new ask.
 */
export function promptEchoTitle(explicitPrompt: boolean, isBtw: boolean, isNewSession: boolean): string {
  if (explicitPrompt) return isBtw ? 'Side Chat (BTW)' : 'User Prompt';
  return isNewSession ? 'User Prompt' : 'Resume';
}
