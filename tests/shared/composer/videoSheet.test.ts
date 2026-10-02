import test from 'node:test';
import assert from 'node:assert';
import {
  MAX_SHEET_FRAMES,
  VIDEO_SAMPLE_FPS,
  isVideoType,
  parseProbe,
  planSheet,
  sheetCaption,
  sheetFilter
} from '../../../shared/composer/videoSheet.js';

test('recognises a video by its type', () => {
  assert.ok(isVideoType('video/mp4'));
  assert.ok(isVideoType('Video/QuickTime'));
  assert.ok(!isVideoType('image/gif'));
  assert.ok(!isVideoType(''));
});

test('reads size and length from ffprobe, preferring the stream\'s own duration', () => {
  assert.deepStrictEqual(
    parseProbe({ streams: [{ width: 1920, height: 1080, duration: '12.5' }], format: { duration: '13' } }),
    { durationSec: 12.5, width: 1920, height: 1080 }
  );
  assert.deepStrictEqual(
    parseProbe({ streams: [{ width: 640, height: 480 }], format: { duration: '4.0' } }),
    { durationSec: 4, width: 640, height: 480 }
  );
});

test('a portrait phone clip is planned at the size ffmpeg will decode it to', () => {
  const sideData = parseProbe({ streams: [{ width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] }] });
  assert.deepStrictEqual(sideData, { width: 1080, height: 1920 });
  const tag = parseProbe({ streams: [{ width: 1920, height: 1080, tags: { rotate: '270' } }] });
  assert.deepStrictEqual(tag, { width: 1080, height: 1920 });
  const upsideDown = parseProbe({ streams: [{ width: 1920, height: 1080, tags: { rotate: '180' } }] });
  assert.deepStrictEqual(upsideDown, { width: 1920, height: 1080 });
});

test('a file with no picture to it is not a video', () => {
  assert.strictEqual(parseProbe({ streams: [] }), null);
  assert.strictEqual(parseProbe({ streams: [{ width: 0, height: 0 }] }), null);
  assert.strictEqual(parseProbe(null), null);
  // A WebM straight out of a recorder often has no duration at all.
  assert.deepStrictEqual(parseProbe({ streams: [{ width: 2, height: 2, duration: 'N/A' }] }), { width: 2, height: 2 });
});

test('a short clip is sampled at the default rate', () => {
  const plan = planSheet({ durationSec: 6, width: 1280, height: 720 });
  assert.strictEqual(plan.fps, VIDEO_SAMPLE_FPS);
  assert.strictEqual(plan.frames, 12);
  assert.ok(plan.columns * plan.rows >= plan.frames);
});

test('a long clip is sampled more sparsely so it still fits on one sheet', () => {
  const plan = planSheet({ durationSec: 120, width: 1280, height: 720 });
  assert.strictEqual(plan.frames, MAX_SHEET_FRAMES);
  assert.ok(plan.fps < VIDEO_SAMPLE_FPS);
  assert.ok(Math.abs(plan.frames / plan.fps - 120) < 0.5);
});

test('a clip of unknown length takes as many frames as fit, at the default rate', () => {
  const plan = planSheet({ width: 1280, height: 720 });
  assert.strictEqual(plan.frames, MAX_SHEET_FRAMES);
  assert.strictEqual(plan.fps, VIDEO_SAMPLE_FPS);
});

test('the sheet comes out roughly square, with even cell sizes that keep the aspect', () => {
  for (const [width, height] of [[1920, 1080], [1080, 1920], [640, 640], [3840, 1080]] as const) {
    const plan = planSheet({ durationSec: 30, width, height });
    const sheetWidth = plan.columns * plan.cellWidth;
    const sheetHeight = plan.rows * plan.cellHeight;
    const ratio = sheetWidth / sheetHeight;
    assert.ok(ratio > 0.4 && ratio < 2.5, `${width}x${height} gave a ${sheetWidth}x${sheetHeight} sheet`);
    assert.strictEqual(plan.cellWidth % 2, 0);
    assert.strictEqual(plan.cellHeight % 2, 0);
    assert.ok(Math.abs(plan.cellWidth / plan.cellHeight - width / height) < 0.05);
    assert.ok(sheetWidth <= 2048 && sheetHeight <= 2048);
  }
});

test('a tiny video is never scaled up', () => {
  const plan = planSheet({ durationSec: 1, width: 64, height: 48 });
  assert.strictEqual(plan.cellWidth, 64);
  assert.strictEqual(plan.cellHeight, 48);
});

test('the filter samples, letterboxes and tiles in that order', () => {
  const plan = planSheet({ durationSec: 6, width: 1280, height: 720 });
  const filter = sheetFilter(plan);
  assert.ok(filter.startsWith(`fps=${plan.fps},scale=${plan.cellWidth}:${plan.cellHeight}`));
  assert.ok(filter.includes(`tile=${plan.columns}x${plan.rows}`));
});

test('the caption tells the agent it is looking at time, and in which order', () => {
  const probe = { durationSec: 6, width: 1280, height: 720 };
  const plan = planSheet(probe);
  const caption = sheetCaption('login.mov', probe, plan);
  assert.ok(caption.includes('"login.mov"'));
  assert.ok(caption.includes('12 frames'));
  assert.ok(caption.includes('0.5 s apart'));
  assert.ok(caption.includes('left to right, top to bottom'));

  const unknown = sheetCaption('rec.webm', { width: 1280, height: 720 }, planSheet({ width: 1280, height: 720 }));
  assert.ok(unknown.includes('length unknown'));
});
