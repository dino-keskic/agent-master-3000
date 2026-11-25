/**
 * Media targets referenced in markdown transcripts and OpenCode DB parts.
 *
 * Pure decisions: which file extensions count as images or videos, how a
 * markdown `![alt](src)` target resolves to a safe browser URL (refusing
 * active schemes and non-media local paths), and how an OpenCode `file` /
 * `image` part is turned into inline markdown. Serving the files themselves
 * lives in `server/routes/attachments.ts`.
 */

export type MediaKind = 'image' | 'video';

export const IMAGE_EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp'
};

export const VIDEO_EXTENSIONS: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.ogv': 'video/ogg'
};

const SAFE_DATA_IMAGE = /^data:image\/(png|jpeg|jpg|gif|webp|avif);base64,[A-Za-z0-9+/=\s]+$/i;
const URI_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/** Cap inline data URLs read from OpenCode's DB so a huge blob cannot stall rendering. */
export const MAX_INLINE_DATA_MEDIA_LENGTH = 2 * 1024 * 1024;

function stripQueryHash(target: string): string {
  const query = target.indexOf('?');
  const hash = target.indexOf('#');
  let end = target.length;
  if (query !== -1 && query < end) end = query;
  if (hash !== -1 && hash < end) end = hash;
  return target.slice(0, end);
}

function extensionOf(target: string): string {
  const clean = stripQueryHash(target);
  const base = clean.split(/[\\/]/).pop() || '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

/** Pure POSIX path normalization without importing `node:path`. */
function normalizePosix(input: string): string {
  const parts = input.split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return `/${stack.join('/')}`;
}

function decodePercent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function mediaApiUrl(absPath: string, taskId?: string): string {
  const base = `/api/media?path=${encodeURIComponent(absPath)}`;
  return taskId ? `${base}&taskId=${encodeURIComponent(taskId)}` : base;
}

/** Whether a path or URL points to a supported image or video extension. */
export function mediaKindForPath(target: string): MediaKind | null {
  const ext = extensionOf(target);
  if (ext in IMAGE_EXTENSIONS) return 'image';
  if (ext in VIDEO_EXTENSIONS) return 'video';
  return null;
}

/** The MIME type for a supported image or video path, or null for anything else. */
export function mediaMimeForPath(target: string): string | null {
  const ext = extensionOf(target);
  return IMAGE_EXTENSIONS[ext] ?? VIDEO_EXTENSIONS[ext] ?? null;
}

export interface ResolvedMedia {
  kind: MediaKind;
  url: string;
  localPath?: string;
}

/**
 * Resolve a markdown media target (`![alt](src)`) into a safe browser URL and
 * kind, or null when the target is unsafe or points at a non-media local file.
 */
export function resolveMediaTarget(
  src: string,
  ctx: { cwd?: string; taskId?: string } = {}
): ResolvedMedia | null {
  const trimmed = src.trim();
  if (!trimmed) return null;

  if (/^(?:javascript|vbscript):/i.test(trimmed)) return null;

  if (/^data:/i.test(trimmed)) {
    return SAFE_DATA_IMAGE.test(trimmed) ? { kind: 'image', url: trimmed } : null;
  }

  if (trimmed.startsWith('/api/attachments/')) {
    return { kind: mediaKindForPath(trimmed) ?? 'image', url: trimmed };
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return { kind: mediaKindForPath(trimmed) ?? 'image', url: trimmed };
  }

  if (/^file:\/\//i.test(trimmed)) {
    const raw = stripQueryHash(trimmed.replace(/^file:\/\/(?:localhost)?/i, ''));
    const decoded = decodePercent(raw);
    if (!decoded.startsWith('/')) return null;
    const kind = mediaKindForPath(decoded);
    if (!kind) return null;
    const absPath = normalizePosix(decoded);
    return { kind, url: mediaApiUrl(absPath, ctx.taskId), localPath: absPath };
  }

  // Reject any other URI scheme (`ftp:`, `mailto:`, `blob:`, etc.).
  if (URI_SCHEME.test(trimmed)) return null;

  const clean = stripQueryHash(trimmed);
  const kind = mediaKindForPath(clean);
  if (!kind) return null;

  if (clean.startsWith('/')) {
    const absPath = normalizePosix(clean);
    return { kind, url: mediaApiUrl(absPath, ctx.taskId), localPath: absPath };
  }

  if (!ctx.cwd || !ctx.cwd.startsWith('/')) return null;
  const absPath = normalizePosix(`${ctx.cwd}/${clean}`);
  return { kind, url: mediaApiUrl(absPath, ctx.taskId), localPath: absPath };
}

/** Whether a MIME type is a safe image or video type for transcript playback. */
export function isSafeMediaMime(mime: string | undefined): boolean {
  if (!mime) return false;
  const lower = mime.toLowerCase();
  if (lower === 'image/svg+xml') return false;
  return lower.startsWith('image/') || lower.startsWith('video/');
}

/**
 * Convert a media part from OpenCode's DB (`file` or `image`) into inline
 * markdown `![name](url)`, or undefined when the part is not renderable media.
 */
export function mediaPartToMarkdown(part: {
  url?: unknown;
  mime?: unknown;
  mimeType?: unknown;
  filename?: unknown;
  name?: unknown;
}): string | undefined {
  const url = typeof part.url === 'string' ? part.url.trim() : '';
  if (!url) return undefined;

  const mime = typeof part.mime === 'string' ? part.mime : typeof part.mimeType === 'string' ? part.mimeType : '';
  const isDataUrl = /^data:/i.test(url);
  if (isDataUrl) {
    if (url.length > MAX_INLINE_DATA_MEDIA_LENGTH || !SAFE_DATA_IMAGE.test(url)) return undefined;
  } else if (!/^(?:file:\/\/|https?:\/\/|\/api\/attachments\/)/i.test(url)) {
    return undefined;
  }

  const resolved = resolveMediaTarget(url);
  if (!resolved) return undefined;

  const rawName =
    typeof part.filename === 'string'
      ? part.filename
      : typeof part.name === 'string'
        ? part.name
        : '';

  if (!isDataUrl && !isSafeMediaMime(mime) && !mediaKindForPath(url) && !mediaKindForPath(rawName)) {
    return undefined;
  }

  const fallbackName = isDataUrl
    ? 'image'
    : stripQueryHash(url).split(/[\\/]/).pop() || (resolved.kind === 'video' ? 'video' : 'image');
  const alt = (rawName || fallbackName).replace(/[[\]\r\n]/g, '').trim() || resolved.kind;
  const target = /[\s()]/.test(url) ? `<${url}>` : url;
  return `![${alt}](${target})`;
}
