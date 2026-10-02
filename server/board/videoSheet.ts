import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { promisify } from 'util';
import { MAX_CAPTION_LENGTH, PromptImage } from '../../shared/composer/promptImages.js';
import {
  MAX_VIDEO_BYTES,
  parseProbe,
  planSheet,
  sheetCaption,
  sheetFilter
} from '../../shared/composer/videoSheet.js';
import { findExecutable } from '../speech/modelServer.js';
import { newAttachment } from './attachments.js';

/**
 * A dropped video, stored as the one contact-sheet image the agent is sent.
 *
 * The upload is streamed to a temporary file (a video does not fit in a JSON
 * body, nor comfortably in memory), probed with ffprobe, tiled with ffmpeg
 * into the attachments directory, and then thrown away: the board keeps the
 * sheet, never the video. What the sheet looks like is decided in
 * `shared/composer/videoSheet.ts`.
 *
 * Env: `FFMPEG_PATH` / `FFPROBE_PATH` when the binaries are somewhere the
 * usual search (PATH, Homebrew, /usr/local/bin) does not look.
 */

const run = promisify(execFile);

/** Long enough for a few minutes of 4K; short enough that a stuck decode is noticed. */
const FFMPEG_TIMEOUT_MS = 3 * 60_000;

/** An error whose message is meant for the person who dropped the video. */
export class VideoSheetError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'VideoSheetError';
  }
}

function tools(): { ffmpeg: string; ffprobe: string } {
  const ffmpeg = findExecutable('ffmpeg', process.env.FFMPEG_PATH);
  if (!ffmpeg) {
    throw new VideoSheetError('Attaching a video needs ffmpeg, which is not installed (brew install ffmpeg)', 503);
  }
  // ffprobe ships beside ffmpeg; look there first so the two always match.
  const sibling = path.join(path.dirname(ffmpeg), 'ffprobe');
  const ffprobe = process.env.FFPROBE_PATH || (fs.existsSync(sibling) ? sibling : findExecutable('ffprobe'));
  if (!ffprobe) {
    throw new VideoSheetError('Attaching a video needs ffprobe, which came without ffmpeg here', 503);
  }
  return { ffmpeg, ffprobe };
}

/** Copy a request body to `file`, refusing it the moment it passes the cap. */
async function receive(body: Readable, file: string): Promise<number> {
  let received = 0;
  await pipeline(
    body,
    async function* (chunks: AsyncIterable<Buffer>) {
      for await (const chunk of chunks) {
        received += chunk.length;
        if (received > MAX_VIDEO_BYTES) {
          throw new VideoSheetError(`That video is larger than ${Math.round(MAX_VIDEO_BYTES / (1024 * 1024))} MB`, 413);
        }
        yield chunk;
      }
    },
    fs.createWriteStream(file)
  );
  return received;
}

/** ffmpeg's last stderr line is the useful one; the rest is its banner and config. */
function ffmpegReason(e: unknown): string {
  const stderr = (e as { stderr?: string }).stderr?.trim();
  return stderr?.split('\n').pop() || (e instanceof Error ? e.message : 'unknown error');
}

/**
 * Turn an uploaded video into a stored contact sheet and return its reference,
 * caption included. Throws `VideoSheetError` with a message for the user.
 */
export async function saveVideoSheet(body: Readable, name: string): Promise<PromptImage> {
  const { ffmpeg, ffprobe } = tools();
  const displayName = name.slice(0, 200) || 'video';
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'board-video-'));
  const input = path.join(scratch, 'input');

  try {
    if ((await receive(body, input)) === 0) throw new VideoSheetError('That video arrived empty');

    let probed: unknown;
    try {
      const { stdout } = await run(ffprobe, [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,duration:stream_tags=rotate:stream_side_data=rotation:format=duration',
        '-of', 'json',
        input
      ], { timeout: 30_000 });
      probed = JSON.parse(stdout);
    } catch {
      throw new VideoSheetError(`${displayName} is not a video ffmpeg can read`);
    }
    const probe = parseProbe(probed);
    if (!probe) throw new VideoSheetError(`${displayName} has no video track`);

    const plan = planSheet(probe);
    const { id, file } = newAttachment('jpg');
    try {
      await run(ffmpeg, [
        '-hide_banner', '-loglevel', 'error', '-nostdin',
        '-i', input,
        '-an', '-sn', '-dn',
        '-vf', sheetFilter(plan),
        '-frames:v', '1',
        '-q:v', '3',
        '-y', file
      ], { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
    } catch (e) {
      fs.rmSync(file, { force: true });
      throw new VideoSheetError(`Could not sample ${displayName}: ${ffmpegReason(e)}`, 422);
    }

    // A clip whose frames all fail to decode exits cleanly with nothing written.
    if (!fs.existsSync(file)) throw new VideoSheetError(`${displayName} had no frames ffmpeg could decode`, 422);
    const size = fs.statSync(file).size;
    return {
      id,
      name: displayName,
      mimeType: 'image/jpeg',
      size,
      caption: sheetCaption(displayName, probe, plan).slice(0, MAX_CAPTION_LENGTH)
    };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
