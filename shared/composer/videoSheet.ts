/**
 * A dropped video, turned into one picture the agent can read.
 *
 * No model the board drives takes video, so the server samples frames with
 * ffmpeg and tiles them into a single contact sheet. Everything here decides
 * what that sheet looks like — how often to sample, how many frames fit, the
 * grid and cell size — and what the agent is told about it. Running ffprobe
 * and ffmpeg is `server/board/videoSheet.ts`.
 */

/** How often a short clip is sampled. Enough to follow a UI flow click by click. */
export const VIDEO_SAMPLE_FPS = 2;

/**
 * Frames on one sheet. Past this a longer clip is sampled more sparsely rather
 * than the cells shrinking until nothing in them is legible.
 */
export const MAX_SHEET_FRAMES = 36;

/** A cell's long side, at most. A screen recording stays readable at this size. */
const MAX_CELL_SIDE = 480;

/**
 * The sheet's long side, at most. Models scale anything bigger down before
 * they look at it, so pixels past this are upload cost and nothing else.
 */
const MAX_SHEET_SIDE = 2048;

/** Pixels between cells and around the edge, so frames do not run together. */
export const SHEET_PADDING = 4;

/** Per upload. A few minutes of screen recording; the bytes never leave the machine. */
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

export function isVideoType(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith('video/');
}

/** Why this video cannot be attached, or `undefined` if it can. */
export function videoRejection(file: { name: string; size: number }): string | undefined {
  if (file.size > MAX_VIDEO_BYTES) {
    return `${file.name || 'That video'} is larger than ${Math.round(MAX_VIDEO_BYTES / (1024 * 1024))} MB.`;
  }
  return undefined;
}

/** What ffprobe says about a video's first stream, as far as a sheet needs. */
export interface VideoProbe {
  /** Seconds, or undefined when the container does not say (a recorded WebM often does not). */
  durationSec?: number;
  /** As displayed, after any rotation the file asks for. */
  width: number;
  height: number;
}

function positive(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Read `ffprobe -of json` output. A phone records portrait video as landscape
 * pixels plus a rotation, and ffmpeg applies that rotation when it decodes, so
 * the size the sheet is planned for has to be the rotated one.
 */
export function parseProbe(json: unknown): VideoProbe | null {
  const root = json as {
    streams?: {
      width?: number;
      height?: number;
      duration?: string;
      tags?: { rotate?: string };
      side_data_list?: { rotation?: number }[];
    }[];
    format?: { duration?: string };
  } | null;
  const stream = root?.streams?.[0];
  const width = positive(stream?.width);
  const height = positive(stream?.height);
  if (!stream || !width || !height) return null;

  const rotation = Number(stream.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? stream.tags?.rotate ?? 0);
  const sideways = Math.abs(rotation) % 180 === 90;
  const durationSec = positive(stream.duration) ?? positive(root.format?.duration);
  return {
    ...(durationSec ? { durationSec } : {}),
    width: sideways ? height : width,
    height: sideways ? width : height
  };
}

export interface SheetPlan {
  /** What ffmpeg's `fps` filter is given. Below the default for a long clip. */
  fps: number;
  frames: number;
  columns: number;
  rows: number;
  /** One cell, in pixels. Even, because some encoders refuse odd sizes. */
  cellWidth: number;
  cellHeight: number;
}

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

/**
 * Pick the column count that makes the whole sheet closest to square: a long
 * strip of tiny frames is the shape a model scales down hardest.
 */
function bestColumns(frames: number, aspect: number): number {
  let best = 1;
  let bestScore = Infinity;
  for (let columns = 1; columns <= frames; columns++) {
    const rows = Math.ceil(frames / columns);
    const score = Math.abs(Math.log((columns * aspect) / rows));
    if (score < bestScore) {
      best = columns;
      bestScore = score;
    }
  }
  return best;
}

/** How to sample and tile one video. */
export function planSheet(probe: VideoProbe): SheetPlan {
  const duration = probe.durationSec;
  // Unknown length: sample at the usual rate and take as many as fit. ffmpeg
  // stops at a full sheet, so a long clip of unknown length shows its start.
  const wanted = duration ? Math.ceil(duration * VIDEO_SAMPLE_FPS) : MAX_SHEET_FRAMES;
  const frames = Math.max(1, Math.min(MAX_SHEET_FRAMES, wanted));
  const fps = duration && wanted > MAX_SHEET_FRAMES ? MAX_SHEET_FRAMES / duration : VIDEO_SAMPLE_FPS;

  const aspect = probe.width / probe.height;
  const columns = bestColumns(frames, aspect);
  const rows = Math.ceil(frames / columns);

  const room = (count: number) => MAX_SHEET_SIDE - SHEET_PADDING * (count + 1);
  const scale = Math.min(
    MAX_CELL_SIDE / Math.max(probe.width, probe.height),
    room(columns) / (columns * probe.width),
    room(rows) / (rows * probe.height),
    1
  );
  return {
    fps: Math.round(fps * 1000) / 1000,
    frames,
    columns,
    rows,
    cellWidth: even(probe.width * scale),
    cellHeight: even(probe.height * scale)
  };
}

/** The ffmpeg filter chain that turns the video into the sheet `plan` describes. */
export function sheetFilter(plan: SheetPlan): string {
  const { cellWidth: w, cellHeight: h } = plan;
  return [
    `fps=${plan.fps}`,
    // Letterbox rather than stretch, in case the probe and the decoder
    // disagree about rotation or the stream changes size midway.
    `scale=${w}:${h}:force_original_aspect_ratio=decrease`,
    `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`,
    'setsar=1',
    `tile=${plan.columns}x${plan.rows}:padding=${SHEET_PADDING}:margin=${SHEET_PADDING}:color=0x202020`
  ].join(',');
}

function seconds(value: number): string {
  return value >= 10 ? `${Math.round(value)} s` : `${Math.round(value * 10) / 10} s`;
}

/**
 * What the agent is told beside the picture. Without it a contact sheet reads
 * as a strange screenshot; with it the model knows it is looking at time, in
 * which order, and how far apart the frames are.
 */
export function sheetCaption(name: string, probe: VideoProbe, plan: SheetPlan): string {
  const gap = seconds(1 / plan.fps);
  const length = probe.durationSec
    ? ` (${seconds(probe.durationSec)} long)`
    : ` (length unknown, so at most its first ${seconds(plan.frames / plan.fps)})`;
  return (
    `The image above is a contact sheet of the video "${name}"${length}: ` +
    `${plan.frames} frames sampled ${gap} apart, in a ${plan.columns}×${plan.rows} grid ` +
    `read left to right, top to bottom. Frame n (counting from 0) is at about n × ${gap}.`
  );
}
