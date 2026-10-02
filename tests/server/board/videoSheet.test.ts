import test from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { findExecutable } from '../../../server/speech/modelServer.js';

// The attachments directory is fixed when the module loads, so point it at a
// scratch folder first and import afterwards.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'video-sheet-test-'));
process.env.BOARD_ATTACHMENTS_DIR = path.join(scratch, 'attachments');
const { saveVideoSheet, VideoSheetError } = await import('../../../server/board/videoSheet.js');

const ffmpeg = findExecutable('ffmpeg', process.env.FFMPEG_PATH);
const skip = ffmpeg ? false : 'ffmpeg is not installed';

test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

function clip(seconds: number, size: string): string {
  const file = path.join(scratch, `clip-${seconds}-${size}.mp4`);
  execFileSync(ffmpeg!, [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-f', 'lavfi', '-i', `testsrc=duration=${seconds}:size=${size}:rate=25`,
    '-pix_fmt', 'yuv420p', '-y', file
  ]);
  return file;
}

function dimensions(file: string): { width: number; height: number } {
  const ffprobe = path.join(path.dirname(ffmpeg!), 'ffprobe');
  const out = execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', file]);
  const stream = (JSON.parse(out.toString()) as { streams: { width: number; height: number }[] }).streams[0]!;
  return { width: stream.width, height: stream.height };
}

test('turns a clip into one stored JPEG contact sheet with a caption', { skip }, async () => {
  const image = await saveVideoSheet(fs.createReadStream(clip(5, '320x240')), 'demo.mp4');

  assert.match(image.id, /\.jpg$/);
  assert.strictEqual(image.mimeType, 'image/jpeg');
  assert.strictEqual(image.name, 'demo.mp4');
  assert.ok(image.caption?.includes('10 frames'), image.caption ?? 'no caption');

  const stored = path.join(process.env.BOARD_ATTACHMENTS_DIR!, image.id);
  assert.strictEqual(fs.statSync(stored).size, image.size);
  // 10 frames of 4:3 tile best as 3 columns by 4 rows of 320x240 cells,
  // with 4px of padding between and around them.
  assert.deepStrictEqual(dimensions(stored), { width: 3 * 320 + 4 * 4, height: 4 * 240 + 5 * 4 });
});

test('refuses something that is not a video, and leaves nothing behind', { skip }, async () => {
  const before = fs.existsSync(process.env.BOARD_ATTACHMENTS_DIR!) ? fs.readdirSync(process.env.BOARD_ATTACHMENTS_DIR!).length : 0;
  await assert.rejects(
    saveVideoSheet(Readable.from([Buffer.from('definitely not a video')]), 'notes.mp4'),
    (e: unknown) => e instanceof VideoSheetError && e.message.includes('notes.mp4')
  );
  const after = fs.existsSync(process.env.BOARD_ATTACHMENTS_DIR!) ? fs.readdirSync(process.env.BOARD_ATTACHMENTS_DIR!).length : 0;
  assert.strictEqual(after, before);
});

test('an empty upload is refused before ffmpeg ever runs', { skip }, async () => {
  await assert.rejects(
    saveVideoSheet(Readable.from([]), 'empty.mp4'),
    (e: unknown) => e instanceof VideoSheetError && /empty/.test(e.message)
  );
});
