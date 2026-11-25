import test from 'node:test';
import assert from 'node:assert';
import {
  TASK_SIDEBAR_BOUNDS,
  WORK_RAIL_BOUNDS,
  clampPanelWidth,
  parseStoredWidth,
  resizeSplitWeights,
  resizedWidth,
  syncSplitWeights
} from '../../../shared/board/panelResize.js';

test('clampPanelWidth respects min, max, and container main-pane reserve', () => {
  assert.strictEqual(clampPanelWidth(100, WORK_RAIL_BOUNDS), WORK_RAIL_BOUNDS.min);
  assert.strictEqual(clampPanelWidth(900, WORK_RAIL_BOUNDS), WORK_RAIL_BOUNDS.max);
  assert.strictEqual(clampPanelWidth(Number.NaN, WORK_RAIL_BOUNDS), WORK_RAIL_BOUNDS.defaultSize);
  // With a 600px container and 320px main-pane reserve, panel caps at 280px.
  assert.strictEqual(clampPanelWidth(400, WORK_RAIL_BOUNDS, 600), 280);
});

test('parseStoredWidth falls back safely on missing or corrupt storage', () => {
  assert.strictEqual(parseStoredWidth(null, TASK_SIDEBAR_BOUNDS), TASK_SIDEBAR_BOUNDS.defaultSize);
  assert.strictEqual(parseStoredWidth('not-a-number', TASK_SIDEBAR_BOUNDS), TASK_SIDEBAR_BOUNDS.defaultSize);
  assert.strictEqual(parseStoredWidth('340', TASK_SIDEBAR_BOUNDS), 340);
  assert.strictEqual(parseStoredWidth('9999', TASK_SIDEBAR_BOUNDS), TASK_SIDEBAR_BOUNDS.max);
});

test('resizedWidth grows in opposite directions for left vs right edges', () => {
  assert.strictEqual(resizedWidth(272, 40, 'right', WORK_RAIL_BOUNDS), 312);
  assert.strictEqual(resizedWidth(272, -40, 'right', WORK_RAIL_BOUNDS), 232);
  assert.strictEqual(resizedWidth(272, -40, 'left', TASK_SIDEBAR_BOUNDS), 312);
  assert.strictEqual(resizedWidth(272, 40, 'left', TASK_SIDEBAR_BOUNDS), 232);
});

test('syncSplitWeights preserves array identity when count is unchanged', () => {
  const initial = [0.4, 0.6];
  assert.strictEqual(syncSplitWeights(initial, 2), initial);
  assert.deepStrictEqual(syncSplitWeights(initial, 3), [1 / 3, 1 / 3, 1 / 3]);
});

test('resizeSplitWeights shifts adjacent panes without breaching minShare or total', () => {
  const next = resizeSplitWeights([0.5, 0.5], 0, 0.15, 0.2);
  assert.ok(Math.abs(next[0]! - 0.65) < 1e-9);
  assert.ok(Math.abs(next[1]! - 0.35) < 1e-9);

  const clamped = resizeSplitWeights([0.5, 0.5], 0, 0.45, 0.2);
  assert.ok(Math.abs(clamped[0]! - 0.8) < 1e-9);
  assert.ok(Math.abs(clamped[1]! - 0.2) < 1e-9);

  // Three panes: moving divider 0 leaves pane 2 untouched.
  const three = resizeSplitWeights([0.34, 0.33, 0.33], 0, -0.1, 0.2);
  assert.ok(Math.abs(three[0]! - 0.24) < 1e-9);
  assert.ok(Math.abs(three[1]! - 0.43) < 1e-9);
  assert.strictEqual(three[2], 0.33);
});
