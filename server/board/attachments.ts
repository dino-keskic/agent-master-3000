import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  MAX_CAPTION_LENGTH,
  MAX_IMAGE_BYTES,
  PromptImage,
  imageExtension,
  isSupportedImageType,
  parseImageDataUrl
} from '../../shared/composer/promptImages.js';
import { dataDir } from '../app/appPaths.js';

/**
 * The images a prompt carries, on disk.
 *
 * The board's state file is rewritten in full a few times a second while a turn
 * streams, so a base64 screenshot in a log entry would be copied thousands of
 * times over. The bytes live here instead, under one flat directory, and
 * everything else in the board holds the `PromptImage` reference this returns.
 *
 * Ids are the filename, so a lookup is a `readFile` and nothing has to be
 * indexed. Names are checked to be exactly `<uuid>.<ext>` before they are
 * joined onto the directory — an id is client input, and a path is not.
 */

const DIRECTORY = process.env.BOARD_ATTACHMENTS_DIR
  ? path.resolve(process.cwd(), process.env.BOARD_ATTACHMENTS_DIR)
  : path.join(dataDir(), 'attachments');

/** `<uuid>.<ext>` and nothing else — no separators, no dots to climb with. */
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,4}$/;

function ensureDirectory(): string {
  fs.mkdirSync(DIRECTORY, { recursive: true });
  return DIRECTORY;
}

function fileOf(id: string): string | null {
  if (!ID_PATTERN.test(id)) return null;
  return path.join(DIRECTORY, id);
}

/** The type a stored file holds, taken from the extension its id carries. */
function mimeOf(id: string): string {
  const extension = path.extname(id).slice(1).toLowerCase();
  return extension === 'jpg' ? 'image/jpeg' : `image/${extension}`;
}

/**
 * A fresh place to write one attachment: its id and the full path. For files
 * the board makes itself (a video's contact sheet) rather than receives.
 */
export function newAttachment(extension: string): { id: string; file: string } {
  const id = `${crypto.randomUUID()}.${extension}`;
  return { id, file: path.join(ensureDirectory(), id) };
}

export interface ImageUpload {
  /** What the file was called where it came from. */
  name?: string;
  /** Either a bare base64 payload with `mimeType`, or a whole `data:` URL. */
  data: string;
  mimeType?: string;
}

/**
 * Write one image and return the reference the rest of the board uses.
 * Throws with a message meant for the user: the only caller is a route.
 */
export function saveImage(upload: ImageUpload): PromptImage {
  const parsed = parseImageDataUrl(upload.data);
  // Base64 decoding ignores anything that is not an alphabet character, so a
  // malformed `data:` URL would otherwise be stored as a few bytes of its own
  // header rather than refused.
  if (!parsed && upload.data.trimStart().startsWith('data:')) {
    throw new Error('That image did not arrive as a readable data URL');
  }

  const mimeType = (parsed?.mimeType || upload.mimeType || '').toLowerCase();
  const base64 = parsed?.base64 ?? upload.data;

  if (!isSupportedImageType(mimeType)) {
    throw new Error(`${mimeType || 'That file'} is not an image the agent can read`);
  }

  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0) throw new Error('That image arrived empty');
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new Error(`That image is larger than ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB`);
  }

  const { id, file } = newAttachment(imageExtension(mimeType));
  fs.writeFileSync(file, bytes);
  return { id, name: upload.name?.slice(0, 200) || id, mimeType, size: bytes.length };
}

/** The stored bytes, or null when the id names nothing. */
export function readImage(id: string): { mimeType: string; bytes: Buffer } | null {
  const file = fileOf(id);
  if (!file || !fs.existsSync(file)) return null;
  return { mimeType: mimeOf(id), bytes: fs.readFileSync(file) };
}

/**
 * The references that actually exist on disk, in the order asked for.
 *
 * Ids come from the client, so a turn is only ever sent images the board
 * itself stored; anything else is dropped rather than failing the send. Each
 * entry may be a bare id or the `{ id, name }` the upload handed back — the
 * name is the user's filename and only ever shown, the size and type are
 * re-read from the file. A caption the board wrote at upload rides along.
 */
export function resolveImages(input: unknown): PromptImage[] {
  if (!Array.isArray(input)) return [];
  const images: PromptImage[] = [];
  for (const entry of input) {
    const ref = typeof entry === 'string' ? undefined : (entry as Partial<PromptImage> | undefined);
    const id = typeof entry === 'string' ? entry : ref?.id;
    const name = ref?.name;
    const caption = typeof ref?.caption === 'string' ? ref.caption.slice(0, MAX_CAPTION_LENGTH) : undefined;
    if (typeof id !== 'string') continue;
    const file = fileOf(id);
    if (!file) continue;

    let size: number;
    try {
      size = fs.statSync(file).size;
    } catch {
      continue;
    }
    const mimeType = mimeOf(id);
    if (!isSupportedImageType(mimeType)) continue;
    images.push({
      id,
      name: typeof name === 'string' ? name.slice(0, 200) : id,
      mimeType,
      size,
      ...(caption ? { caption } : {})
    });
  }
  return images;
}

type LoadedImage = { mimeType: string; base64: string; caption?: string };

/**
 * The images as ACP wants them: base64, inline. Read at dispatch, never held —
 * a turn's worth of screenshots is tens of megabytes in memory otherwise.
 * An image whose file has gone is skipped, so a stale reference in an old
 * queued turn cannot fail the send.
 */
export function loadImageData(images: PromptImage[] = []): LoadedImage[] {
  const loaded: LoadedImage[] = [];
  for (const image of images) {
    const file = readImage(image.id);
    if (!file) {
      console.warn(`[Attachments] Image ${image.id} is gone; sending the turn without it`);
      continue;
    }
    loaded.push({
      mimeType: image.mimeType || file.mimeType,
      base64: file.bytes.toString('base64'),
      ...(image.caption ? { caption: image.caption } : {})
    });
  }
  return loaded;
}
