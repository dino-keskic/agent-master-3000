import { parseImageLimitError } from './imageLimit.js';

/**
 * Pure JSON transformations for stripping oldest images out of copied OpenCode
 * session history (both 2.x `session_message` rows and 1.x `part` rows).
 *
 * The newest `keepImages` attachments stay intact so the model retains visual
 * context from recent steps while fitting under strict per-request image limits.
 */

type JsonRecord = Record<string, unknown>;

export interface PruneResult<T> {
  items: T[];
  totalImages: number;
  removedImages: number;
  keptImages: number;
}

export interface V2MessageLike {
  id: string;
  session_id?: string;
  type: string;
  seq: number;
  time_created: number;
  time_updated: number;
  data: string;
}

export interface V1PartLike {
  id: string;
  message_id: string;
  session_id?: string;
  time_created: number;
  time_updated: number;
  data: string;
}

function asObject(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function parseJson(raw: string): JsonRecord | null {
  try {
    return asObject(JSON.parse(raw));
  } catch {
    return null;
  }
}

function isImageMime(value: unknown): boolean {
  return typeof value === 'string' && value.trim().toLowerCase().startsWith('image/');
}

function isImageDataUri(value: unknown): boolean {
  return typeof value === 'string' && value.trim().toLowerCase().startsWith('data:image/');
}

function isImageEntry(entry: unknown): boolean {
  const obj = asObject(entry);
  if (!obj) return false;
  if (obj.type === 'image') return true;
  if (isImageMime(obj.mime) || isImageMime(obj.mimeType)) return true;
  if (isImageDataUri(obj.url) || isImageDataUri(obj.uri)) return true;
  // OpenCode 2 user files use { data, mime, name } — mime handled above; check type:'file' url too
  if (obj.type === 'file' && (isImageMime(obj.mime) || isImageDataUri(obj.uri) || isImageDataUri(obj.url))) {
    return true;
  }
  return false;
}

function imageName(entry: unknown): string | undefined {
  const obj = asObject(entry);
  if (!obj) return undefined;
  const raw = typeof obj.name === 'string' ? obj.name : typeof obj.filename === 'string' ? obj.filename : '';
  return raw.trim() || undefined;
}

function omittedNote(label: string, name?: string): string {
  return name ? `[${label}: ${name}]` : `[${label}]`;
}

function appendNote(existing: unknown, line: string): string {
  const text = typeof existing === 'string' ? existing.trimEnd() : '';
  return text ? `${text}\n\n${line}` : line;
}

/**
 * Strip the oldest images from OpenCode 2 `session_message` rows, leaving at
 * most `keepImages` newest images across user files, assistant parts, and tool results.
 */
export function pruneV2Messages<T extends V2MessageLike>(rows: readonly T[], keepImages: number): PruneResult<T> {
  const parsed = rows.map((row) => ({ row, json: parseJson(row.data) }));

  const countInBlock = (block: unknown): number => {
    const obj = asObject(block);
    if (!obj) return 0;
    if (isImageEntry(obj)) return 1;
    if (obj.type === 'tool') {
      const state = asObject(obj.state);
      if (!state) return 0;
      let count = 0;
      if (Array.isArray(state.content)) {
        for (const item of state.content) if (isImageEntry(item)) count += 1;
      }
      if (Array.isArray(state.attachments)) {
        for (const item of state.attachments) if (isImageEntry(item)) count += 1;
      }
      return count;
    }
    return 0;
  };

  let totalImages = 0;
  for (const { row, json } of parsed) {
    if (!json) continue;
    if (row.type === 'user' && Array.isArray(json.files)) {
      for (const file of json.files) if (isImageEntry(file)) totalImages += 1;
    }
    if (Array.isArray(json.content)) {
      for (const block of json.content) totalImages += countInBlock(block);
    }
  }

  const targetKeep = Math.max(0, keepImages);
  const stripTarget = Math.max(0, totalImages - targetKeep);
  if (stripTarget === 0) {
    return { items: [...rows], totalImages, removedImages: 0, keptImages: totalImages };
  }

  let removed = 0;

  const rewriteContentArray = (list: unknown[]): unknown[] => {
    const next: unknown[] = [];
    for (const block of list) {
      const obj = asObject(block);
      if (!obj) {
        next.push(block);
        continue;
      }
      if (isImageEntry(obj)) {
        if (removed < stripTarget) {
          removed += 1;
          next.push({ type: 'text', text: omittedNote('Earlier image omitted to fit model limit', imageName(obj)) });
        } else {
          next.push(block);
        }
        continue;
      }
      if (obj.type === 'tool') {
        const state = asObject(obj.state);
        if (!state) {
          next.push(block);
          continue;
        }
        let changed = false;
        const nextState: JsonRecord = { ...state };
        if (Array.isArray(state.content)) {
          const nextToolContent: unknown[] = [];
          for (const entry of state.content) {
            if (isImageEntry(entry) && removed < stripTarget) {
              removed += 1;
              changed = true;
              nextToolContent.push({
                type: 'text',
                text: omittedNote('Image omitted to fit model limit', imageName(entry))
              });
            } else {
              nextToolContent.push(entry);
            }
          }
          if (changed) nextState.content = nextToolContent;
        }
        if (Array.isArray(state.attachments)) {
          const notes: string[] = [];
          const nextAttachments: unknown[] = [];
          for (const att of state.attachments) {
            if (isImageEntry(att) && removed < stripTarget) {
              removed += 1;
              changed = true;
              notes.push(omittedNote('Image omitted to fit model limit', imageName(att)));
            } else {
              nextAttachments.push(att);
            }
          }
          if (notes.length > 0) {
            if (nextAttachments.length > 0) nextState.attachments = nextAttachments;
            else delete nextState.attachments;
            if (typeof nextState.output === 'string' || !Array.isArray(nextState.content)) {
              nextState.output = appendNote(nextState.output, notes.join('\n'));
            }
          }
        }
        next.push(changed ? { ...obj, state: nextState } : block);
        continue;
      }
      next.push(block);
    }
    return next;
  };

  const items = parsed.map(({ row, json }) => {
    if (!json || removed >= stripTarget) return row;
    let changed = false;
    const nextJson: JsonRecord = { ...json };

    if (row.type === 'user' && Array.isArray(json.files)) {
      const notes: string[] = [];
      const keptFiles: unknown[] = [];
      for (const file of json.files) {
        if (isImageEntry(file) && removed < stripTarget) {
          removed += 1;
          changed = true;
          notes.push(omittedNote('Earlier image omitted to fit model limit', imageName(file)));
        } else {
          keptFiles.push(file);
        }
      }
      if (notes.length > 0) {
        if (keptFiles.length > 0) nextJson.files = keptFiles;
        else delete nextJson.files;
        nextJson.text = appendNote(nextJson.text, notes.join('\n'));
      }
    }

    if (Array.isArray(json.content) && removed < stripTarget) {
      const before = removed;
      const rewritten = rewriteContentArray(json.content);
      if (removed > before) {
        nextJson.content = rewritten;
        changed = true;
      }
    }

    return changed ? { ...row, data: JSON.stringify(nextJson) } : row;
  });

  return {
    items,
    totalImages,
    removedImages: removed,
    keptImages: totalImages - removed
  };
}

function jsonErrorText(json: JsonRecord | null): string | undefined {
  const err = asObject(json?.error);
  if (!err) return undefined;
  if (typeof err.message === 'string') return err.message;
  const nested = asObject(err.data);
  return typeof nested?.message === 'string' ? nested.message : undefined;
}

/**
 * Drop the trailing failed prompt attempt when cloning for retry (`dropSinceMs`),
 * and strip any trailing errored assistant message caused by an image limit so
 * the recovered session never ends on a broken turn.
 */
export function trimV2Tail<T extends V2MessageLike>(
  rows: readonly T[],
  dropSinceMs?: number,
  retryPromptText?: string
): T[] {
  const out = [...rows];
  const normalizedPrompt = retryPromptText?.trim();
  const isTrailingMatch = (row: T): boolean => {
    const json = parseJson(row.data);
    if (row.type === 'assistant') {
      return !!parseImageLimitError(jsonErrorText(json)) || (dropSinceMs !== undefined && row.time_created >= dropSinceMs);
    }
    if (row.type === 'user' && dropSinceMs !== undefined && row.time_created >= dropSinceMs) {
      if (!normalizedPrompt) return false;
      const text = typeof json?.text === 'string' ? json.text.trim() : '';
      return text === normalizedPrompt;
    }
    return false;
  };

  while (out.length > 0 && isTrailingMatch(out[out.length - 1]!)) {
    out.pop();
  }
  return out;
}

export interface V1MessageLike {
  id: string;
  time_created: number;
  data: string;
}

/**
 * Same tail cleanup for OpenCode 1.x `message` rows, returning surviving messages.
 */
export function trimV1Tail<T extends V1MessageLike>(
  messages: readonly T[],
  dropSinceMs?: number,
  matchesRetriedUser?: (messageId: string) => boolean
): T[] {
  const out = [...messages];
  const isTrailingMatch = (row: T): boolean => {
    const json = parseJson(row.data);
    if (json?.role === 'assistant') {
      return !!parseImageLimitError(jsonErrorText(json)) || (dropSinceMs !== undefined && row.time_created >= dropSinceMs);
    }
    if (json?.role === 'user' && dropSinceMs !== undefined && row.time_created >= dropSinceMs) {
      return matchesRetriedUser ? matchesRetriedUser(row.id) : false;
    }
    return false;
  };
  while (out.length > 0 && isTrailingMatch(out[out.length - 1]!)) {
    out.pop();
  }
  return out;
}

/**
 * Strip the oldest images from OpenCode 1 `part` rows ordered chronologically
 * (by message time_created then part id).
 */
export function pruneV1Parts<T extends V1PartLike>(parts: readonly T[], keepImages: number): PruneResult<T> {
  const parsed = parts.map((part) => ({ part, json: parseJson(part.data) }));

  let totalImages = 0;
  for (const { json } of parsed) {
    if (!json) continue;
    if (json.type === 'image' || (json.type === 'file' && isImageEntry(json))) {
      totalImages += 1;
    } else if (json.type === 'tool') {
      const state = asObject(json.state);
      if (Array.isArray(state?.attachments)) {
        for (const att of state.attachments) if (isImageEntry(att)) totalImages += 1;
      }
      if (Array.isArray(state?.content)) {
        for (const item of state.content) if (isImageEntry(item)) totalImages += 1;
      }
    }
  }

  const targetKeep = Math.max(0, keepImages);
  const stripTarget = Math.max(0, totalImages - targetKeep);
  if (stripTarget === 0) {
    return { items: [...parts], totalImages, removedImages: 0, keptImages: totalImages };
  }

  let removed = 0;
  const items = parsed.map(({ part, json }) => {
    if (!json || removed >= stripTarget) return part;

    if (json.type === 'image' || (json.type === 'file' && isImageEntry(json))) {
      removed += 1;
      return {
        ...part,
        data: JSON.stringify({
          type: 'text',
          text: omittedNote('Earlier image omitted to fit model limit', imageName(json)),
          synthetic: true
        })
      };
    }

    if (json.type === 'tool') {
      const state = asObject(json.state);
      if (!state) return part;
      let changed = false;
      const nextState: JsonRecord = { ...state };
      const notes: string[] = [];

      if (Array.isArray(state.attachments)) {
        const keptAtt: unknown[] = [];
        for (const att of state.attachments) {
          if (isImageEntry(att) && removed < stripTarget) {
            removed += 1;
            changed = true;
            notes.push(omittedNote('Image omitted to fit model limit', imageName(att)));
          } else {
            keptAtt.push(att);
          }
        }
        if (notes.length > 0) {
          if (keptAtt.length > 0) nextState.attachments = keptAtt;
          else delete nextState.attachments;
        }
      }

      if (Array.isArray(state.content) && removed < stripTarget) {
        const nextContent: unknown[] = [];
        for (const item of state.content) {
          if (isImageEntry(item) && removed < stripTarget) {
            removed += 1;
            changed = true;
            nextContent.push({
              type: 'text',
              text: omittedNote('Image omitted to fit model limit', imageName(item))
            });
          } else {
            nextContent.push(item);
          }
        }
        if (changed) nextState.content = nextContent;
      }

      if (notes.length > 0) {
        nextState.output = appendNote(nextState.output, notes.join('\n'));
      }

      if (changed) {
        return { ...part, data: JSON.stringify({ ...json, state: nextState }) };
      }
    }

    return part;
  });

  return {
    items,
    totalImages,
    removedImages: removed,
    keptImages: totalImages - removed
  };
}
