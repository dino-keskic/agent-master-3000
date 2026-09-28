/**
 * Images a prompt carries.
 *
 * The board keeps the bytes on disk and passes *references* around: a log
 * entry, a queued turn and a task all hold `PromptImage`, which is small enough
 * to live in the state file. The bytes are read back only at the moment the
 * turn goes to the agent, and served to the browser from `/api/attachments`.
 *
 * Everything here is a decision — what may be attached, what a reference looks
 * like, what the agent is sent — so it is shared and tested. Reading and
 * writing the files themselves is `server/board/attachments.ts`.
 */

/** A stored image, as the board refers to it everywhere but the wire to ACP. */
export interface PromptImage {
  /** Filename on disk, without the directory: `<uuid>.<ext>`. */
  id: string;
  /** What the file was called when it was dropped, for the tooltip. */
  name: string;
  mimeType: string;
  /** Bytes on disk, so the UI can label a thumbnail without fetching it. */
  size: number;
}

/**
 * What OpenCode accepts as an image part. SVG is deliberately absent: it is a
 * document that can fetch, not a picture, and no model reads it as one.
 */
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
};

/** Per image. Big enough for a retina screenshot, small enough to send. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Per turn. Past this the context cost stops being something a user can judge. */
export const MAX_IMAGES_PER_TURN = 8;

export function isSupportedImageType(mimeType: string): boolean {
  return mimeType.toLowerCase() in EXTENSIONS;
}

/** The extension a stored file gets, so the id alone says what it holds. */
export function imageExtension(mimeType: string): string {
  return EXTENSIONS[mimeType.toLowerCase()] || 'bin';
}

/** Where the browser reads a stored image back from. */
export function imageUrl(image: Pick<PromptImage, 'id'>): string {
  return `/api/attachments/${encodeURIComponent(image.id)}`;
}

/**
 * Why this file cannot be attached, or `undefined` if it can. One sentence,
 * shown as-is: the drop already failed, and a code the user has to look up
 * helps nobody.
 */
export function imageRejection(
  file: { name: string; type: string; size: number },
  alreadyAttached: number
): string | undefined {
  if (!isSupportedImageType(file.type)) {
    return `${file.name || 'That file'} is not an image the agent can read (PNG, JPEG, GIF or WebP).`;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return `${file.name || 'That image'} is larger than ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB.`;
  }
  if (alreadyAttached >= MAX_IMAGES_PER_TURN) {
    return `A turn can carry ${MAX_IMAGES_PER_TURN} images; drop the extra ones into a follow-up.`;
  }
  return undefined;
}

/**
 * Whether a drag is carrying files at all. A card being dragged across the
 * board announces its own types and must not light the composer up as a drop
 * target; only a drag with `Files` on it can become an attachment.
 */
export function dragHasFiles(types: readonly string[] | undefined): boolean {
  return !!types && Array.from(types).includes('Files');
}

/** A `data:` URL split into the two halves an upload needs. */
export function parseImageDataUrl(value: string): { mimeType: string; base64: string } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(value.trim());
  if (!match) return null;
  const [, mimeType, base64] = match;
  if (!mimeType || !base64) return null;
  return { mimeType: mimeType.toLowerCase(), base64 };
}

/** One ACP content block. Loose on purpose — the wire types live in `server/acp/schema.ts`. */
export type PromptBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; data: string };

/**
 * The prompt as the agent receives it.
 *
 * Images come first: a model reads the instruction against the picture it has
 * already seen, and the text is what refers to "this screenshot". A turn with
 * only images is legitimate — the empty text block is dropped rather than sent
 * as a blank instruction.
 */
export function promptBlocks(
  text: string,
  images: { mimeType: string; base64: string }[] = []
): PromptBlock[] {
  const blocks: PromptBlock[] = images.map((image) => ({
    type: 'image',
    mimeType: image.mimeType,
    data: image.base64
  }));
  if (text.trim()) blocks.push({ type: 'text', text });
  return blocks;
}

/** True when two turns carry the same pictures, in the same order. */
export function sameImages(a?: PromptImage[], b?: PromptImage[]): boolean {
  const left = a || [];
  const right = b || [];
  return left.length === right.length && left.every((image, i) => image.id === right[i]?.id);
}

/** What a transcript or a queued turn says about the pictures riding along. */
export function imageCountLabel(images: PromptImage[]): string {
  return images.length === 1 ? '1 image' : `${images.length} images`;
}
