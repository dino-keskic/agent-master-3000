/**
 * Active agent run duration for a session: summing assistant turn intervals
 * from OpenCode's database and adding live elapsed time while a turn is in
 * flight.
 *
 * Pure: clock values (`now`) are passed in by callers so every formatting and
 * accumulation rule is directly unit-testable.
 */

import { TaskRunState } from '../types.js';

export interface TurnTimingRow {
  role?: 'user' | 'assistant';
  rowCreated: number;
  rowUpdated: number;
  timeCreated?: number | null;
  timeCompleted?: number | null;
}

export interface SessionRunDuration {
  /** Sum of completed assistant turn durations in milliseconds. */
  durationMs: number;
  /** Start timestamp (ms) of the latest still-open assistant turn, if any. */
  activeTurnStartedAt?: number;
  /** Start timestamp (ms) of the latest user prompt in this session. */
  lastPromptStartedAt?: number;
  /** Elapsed ms from the latest user prompt to the completion of its final assistant response. */
  lastTurnDurationMs?: number;
}

/**
 * Cap any single unclosed row fallback so a stalled or abandoned turn without
 * `time.completed` never inflates a session to days of fake runtime.
 */
const MAX_UNCLOSED_FALLBACK_MS = 30 * 60 * 1000;

/**
 * Sum active agent execution time across a session's assistant turns and compute
 * end-to-end duration from the latest user prompt to final assistant completion.
 *
 * Completed assistant turns use `time.completed - time.created` (falling back to
 * row timestamps when omitted). Each `user` prompt starts a new turn window for
 * `lastTurnDurationMs` so follow-up prompts measure only the latest request.
 */
export function accumulateRunDuration(turns: readonly TurnTimingRow[]): SessionRunDuration {
  let durationMs = 0;
  let activeTurnStartedAt: number | undefined;
  let lastPromptStartedAt: number | undefined;
  let lastTurnDurationMs: number | undefined;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]!;
    const start = positiveNumber(turn.timeCreated) ?? positiveNumber(turn.rowCreated);
    if (start === undefined) continue;

    if (turn.role === 'user') {
      lastPromptStartedAt = start;
      lastTurnDurationMs = undefined;
      continue;
    }

    const completed = positiveNumber(turn.timeCompleted);
    const isLast = i === turns.length - 1;
    if (completed !== undefined && completed >= start) {
      durationMs += completed - start;
      if (lastPromptStartedAt !== undefined && completed >= lastPromptStartedAt) {
        lastTurnDurationMs = completed - lastPromptStartedAt;
      }
      continue;
    }

    if (isLast) {
      activeTurnStartedAt = start;
      lastTurnDurationMs = undefined;
      continue;
    }

    const updated = positiveNumber(turn.rowUpdated);
    if (updated !== undefined && updated > start) {
      const cappedEnd = Math.min(updated, start + MAX_UNCLOSED_FALLBACK_MS);
      durationMs += cappedEnd - start;
      if (lastPromptStartedAt !== undefined && cappedEnd > lastPromptStartedAt) {
        lastTurnDurationMs = Math.min(cappedEnd - lastPromptStartedAt, MAX_UNCLOSED_FALLBACK_MS);
      }
    }
  }

  return {
    durationMs,
    ...(activeTurnStartedAt !== undefined ? { activeTurnStartedAt } : {}),
    ...(lastPromptStartedAt !== undefined ? { lastPromptStartedAt } : {}),
    ...(lastTurnDurationMs !== undefined ? { lastTurnDurationMs } : {})
  };
}

function positiveNumber(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

export interface SessionDurationLike {
  durationMs?: number;
  activeTurnStartedAt?: number;
  lastPromptStartedAt?: number;
  lastTurnDurationMs?: number;
  runState?: TaskRunState;
  updatedAt?: number;
}

/**
 * Current display duration (ms) for a session.
 *
 * While `runState === 'running'`, adds live elapsed time since the active turn
 * started (`activeTurnStartedAt`, else `updatedAt`). When idle, includes any
 * bounded progress on an unclosed final turn (`updatedAt - activeTurnStartedAt`)
 * so stopped or OpenCode 1.x turns still report their actual run duration.
 */
export function liveSessionDurationMs(
  session: SessionDurationLike | undefined,
  now: number
): number | undefined {
  if (!session) return undefined;
  const base = session.durationMs && session.durationMs > 0 ? session.durationMs : 0;

  if (session.runState === 'running') {
    const started = session.activeTurnStartedAt || session.updatedAt;
    const liveDelta = started && now > started ? Math.min(now - started, MAX_UNCLOSED_FALLBACK_MS) : 0;
    const total = base + liveDelta;
    return total > 0 ? total : undefined;
  }

  let extra = 0;
  if (session.activeTurnStartedAt && session.updatedAt && session.updatedAt > session.activeTurnStartedAt) {
    extra = Math.min(session.updatedAt - session.activeTurnStartedAt, MAX_UNCLOSED_FALLBACK_MS);
  }
  const total = base + extra;
  return total > 0 ? total : undefined;
}

/**
 * Elapsed duration (ms) from the latest user prompt to the agent's completion
 * (or live ticking while that turn is still running).
 */
export function liveLastTurnDurationMs(
  session: SessionDurationLike | undefined,
  now: number
): number | undefined {
  if (!session) return undefined;
  if (session.runState === 'running') {
    const started = session.lastPromptStartedAt || session.activeTurnStartedAt || session.updatedAt;
    if (!started || now <= started) return undefined;
    return Math.min(now - started, MAX_UNCLOSED_FALLBACK_MS);
  }

  if (session.lastTurnDurationMs && session.lastTurnDurationMs > 0) {
    return session.lastTurnDurationMs;
  }
  if (
    session.lastPromptStartedAt &&
    session.updatedAt &&
    session.updatedAt > session.lastPromptStartedAt &&
    (session.durationMs || session.activeTurnStartedAt)
  ) {
    return Math.min(session.updatedAt - session.lastPromptStartedAt, MAX_UNCLOSED_FALLBACK_MS);
  }
  return undefined;
}

/** Sum active run time across multiple sessions of a task. */
export function totalTaskDurationMs(
  sessions: readonly SessionDurationLike[],
  now: number
): number | undefined {
  let total = 0;
  for (const session of sessions) {
    total += liveSessionDurationMs(session, now) ?? 0;
  }
  return total > 0 ? total : undefined;
}

/**
 * Compact human duration matching `elapsed()` in `shared/format.ts`:
 * `<1s`, `14s`, `3m 04s`, `1h 24m`.
 */
export function formatDuration(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return undefined;
  if (ms < 1000) return '<1s';
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m ${String(remSecs).padStart(2, '0')}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${String(mins % 60).padStart(2, '0')}m`;
}
