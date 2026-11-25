import test from 'node:test';
import assert from 'node:assert';
import {
  accumulateRunDuration,
  formatDuration,
  liveLastTurnDurationMs,
  liveSessionDurationMs,
  totalTaskDurationMs
} from '../../../shared/sessions/duration.js';

test('accumulateRunDuration sums completed assistant turns and records open final turn', () => {
  const result = accumulateRunDuration([
    { rowCreated: 1000, rowUpdated: 5000, timeCreated: 1000, timeCompleted: 5000 },
    { rowCreated: 20_000, rowUpdated: 28_000, timeCreated: 20_000, timeCompleted: 28_000 },
    { rowCreated: 40_000, rowUpdated: 45_000, timeCreated: 40_000, timeCompleted: null }
  ]);
  assert.strictEqual(result.durationMs, 12_000);
  assert.strictEqual(result.activeTurnStartedAt, 40_000);
});

test('accumulateRunDuration computes completion duration from the latest user prompt', () => {
  const done = accumulateRunDuration([
    { role: 'user', rowCreated: 1_000, rowUpdated: 1_000, timeCreated: 1_000 },
    { role: 'assistant', rowCreated: 1_500, rowUpdated: 11_000, timeCreated: 1_500, timeCompleted: 11_000 },
    { role: 'user', rowCreated: 50_000, rowUpdated: 50_000, timeCreated: 50_000 },
    { role: 'assistant', rowCreated: 50_500, rowUpdated: 58_000, timeCreated: 50_500, timeCompleted: 58_000 },
    { role: 'assistant', rowCreated: 59_000, rowUpdated: 75_000, timeCreated: 59_000, timeCompleted: 75_000 }
  ]);
  assert.strictEqual(done.durationMs, 9_500 + 7_500 + 16_000);
  assert.strictEqual(done.lastPromptStartedAt, 50_000);
  assert.strictEqual(done.lastTurnDurationMs, 25_000);

  const inProgress = accumulateRunDuration([
    { role: 'user', rowCreated: 1_000, rowUpdated: 1_000, timeCreated: 1_000 },
    { role: 'assistant', rowCreated: 1_200, rowUpdated: 5_000, timeCreated: 1_200, timeCompleted: 5_000 },
    { role: 'user', rowCreated: 20_000, rowUpdated: 20_000, timeCreated: 20_000 },
    { role: 'assistant', rowCreated: 20_500, rowUpdated: 28_000, timeCreated: 20_500, timeCompleted: null }
  ]);
  assert.strictEqual(inProgress.lastPromptStartedAt, 20_000);
  assert.strictEqual(inProgress.lastTurnDurationMs, undefined);
  assert.strictEqual(inProgress.activeTurnStartedAt, 20_500);
});

test('liveSessionDurationMs ticks while running and settles cleanly when idle', () => {
  const running = {
    durationMs: 60_000,
    activeTurnStartedAt: 100_000,
    runState: 'running' as const,
    updatedAt: 102_000
  };
  assert.strictEqual(liveSessionDurationMs(running, 115_000), 75_000);

  const stopped = {
    durationMs: 60_000,
    activeTurnStartedAt: 100_000,
    runState: 'idle' as const,
    updatedAt: 105_000
  };
  assert.strictEqual(liveSessionDurationMs(stopped, 500_000), 65_000);
});

test('liveLastTurnDurationMs ticks from last prompt while running and reports stored completion time when idle', () => {
  assert.strictEqual(
    liveLastTurnDurationMs(
      { lastPromptStartedAt: 20_000, lastTurnDurationMs: 5_000, runState: 'running' },
      35_000
    ),
    15_000
  );
  assert.strictEqual(
    liveLastTurnDurationMs(
      { lastPromptStartedAt: 20_000, lastTurnDurationMs: 25_000, runState: 'idle' },
      500_000
    ),
    25_000
  );
});

test('totalTaskDurationMs sums across every linked session', () => {
  const total = totalTaskDurationMs(
    [
      { durationMs: 30_000, runState: 'idle' },
      { durationMs: 10_000, activeTurnStartedAt: 100_000, runState: 'running' }
    ],
    105_000
  );
  assert.strictEqual(total, 45_000);
});

test('formatDuration renders compact readable durations', () => {
  assert.strictEqual(formatDuration(undefined), undefined);
  assert.strictEqual(formatDuration(0), undefined);
  assert.strictEqual(formatDuration(400), '<1s');
  assert.strictEqual(formatDuration(14_000), '14s');
  assert.strictEqual(formatDuration(184_000), '3m 04s');
  assert.strictEqual(formatDuration(5_040_000), '1h 24m');
});
