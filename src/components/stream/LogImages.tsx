import { useState } from 'react';
import { Film } from 'lucide-react';
import { PromptImage, imageUrl, videoUrl } from '../../../shared/composer/promptImages';
import { MediaLightbox } from './MediaLightbox';

/**
 * The images and videos a turn was sent with, above the text that referred to them.
 *
 * The transcript holds references, not bytes, so these are served back from the
 * attachment store. Uploaded videos play inline with the contact sheet as poster
 * plus a button to inspect the sampled frames; images open in `MediaLightbox`.
 */
export function LogImages({ images }: { images?: PromptImage[] }) {
  const [lightbox, setLightbox] = useState<{ src: string; name: string; caption?: string } | null>(null);

  if (!images?.length) return null;

  return (
    <>
      <div className="flex flex-wrap items-start gap-2 mb-2">
        {images.map((image) => {
          const vidUrl = videoUrl(image);
          if (vidUrl) {
            return (
              <div key={image.id} className="flex flex-col gap-1 max-w-full">
                <video
                  controls
                  playsInline
                  preload="metadata"
                  poster={imageUrl(image)}
                  src={vidUrl}
                  className="max-h-64 max-w-full rounded-md border border-line bg-black"
                />
                <div className="flex items-center gap-2 text-[11px] font-mono text-ink-4">
                  <span className="truncate">{image.name}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setLightbox({
                        src: imageUrl(image),
                        name: `${image.name} (frames)`,
                        caption: image.caption
                      })
                    }
                    className="shrink-0 inline-flex items-center gap-1 text-ink-3 hover:text-ink underline underline-offset-2 decoration-dotted transition-colors"
                  >
                    <Film className="w-3 h-3" />
                    View frames
                  </button>
                </div>
              </div>
            );
          }

          return (
            <button
              key={image.id}
              type="button"
              onClick={() =>
                setLightbox({
                  src: imageUrl(image),
                  name: image.name,
                  caption: image.caption
                })
              }
              title={image.name}
              className="block p-0 border-0 bg-transparent rounded-md overflow-hidden cursor-zoom-in group"
            >
              <img
                src={imageUrl(image)}
                alt={image.name}
                className="block max-h-48 max-w-[260px] object-contain rounded-md border border-line bg-surface-2 group-hover:border-ink-3 transition-colors"
              />
            </button>
          );
        })}
      </div>

      <MediaLightbox
        opened={!!lightbox}
        onClose={() => setLightbox(null)}
        src={lightbox?.src || ''}
        name={lightbox?.name}
        caption={lightbox?.caption}
      />
    </>
  );
}
