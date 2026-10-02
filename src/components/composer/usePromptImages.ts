import { useCallback, useRef, useState } from 'react';
import { PromptImage, attachmentRejection } from '../../../shared/composer/promptImages';
import { isVideoType } from '../../../shared/composer/videoSheet';
import { api } from '../../api';

/**
 * The images attached to the prompt being written.
 *
 * A drop uploads immediately rather than at send: the bytes are then already
 * on the server when the turn goes out, the send stays the same small request
 * it always was, and the thumbnail beside the box is the very file the agent
 * will be given. A video goes up as-is and comes back as the one contact-sheet
 * image the server made of it. What may be attached at all is
 * `shared/composer/promptImages`; what is held here is only the waiting.
 */

export interface PromptImages {
  items: PromptImage[];
  /** True while a drop is still uploading. */
  uploading: boolean;
  /** Why the last drop was refused. Cleared by the next one. */
  error?: string;
  /** Attach files from a drop or a paste. */
  add: (files: File[]) => Promise<void>;
  remove: (id: string) => void;
  /** Forget everything — the turn was sent, or the composer was cleared. */
  clear: () => void;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    // readAsDataURL always resolves to a string; the union is for the other reads.
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsDataURL(file);
  });
}

export function usePromptImages(): PromptImages {
  const [items, setItems] = useState<PromptImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  /**
   * How many are attached, read during an upload. `items` in this closure is a
   * render behind by the time the second file of a drop is checked, and the
   * per-turn cap has to count the ones already on their way up.
   */
  const attached = useRef(0);

  const add = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setError(undefined);
    setUploading(true);

    try {
      for (const file of files) {
        const rejection = attachmentRejection(file, attached.current);
        if (rejection) {
          setError(rejection);
          continue;
        }

        attached.current += 1;
        try {
          const stored = isVideoType(file.type)
            ? await api.uploadVideo(file)
            : await api.uploadImage({ name: file.name, mimeType: file.type, data: await readAsDataUrl(file) });
          setItems((prev) => [...prev, stored]);
        } catch (e) {
          attached.current -= 1;
          setError(e instanceof Error ? e.message : `Could not attach ${file.name}`);
        }
      }
    } finally {
      setUploading(false);
    }
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => {
      const next = prev.filter((image) => image.id !== id);
      attached.current = next.length;
      return next;
    });
    setError(undefined);
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    attached.current = 0;
    setError(undefined);
  }, []);

  return { items, uploading, error, add, remove, clear };
}
