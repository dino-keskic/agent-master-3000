import { PromptImage, imageUrl } from '../../../shared/composer/promptImages';

/**
 * The pictures a turn was sent with, under the text that referred to them.
 *
 * The transcript holds references, not bytes, so these are the same files the
 * agent was handed, read back from the attachment store. Each is a link: the
 * thumbnail is small enough to keep the log readable, and a click opens the
 * full-size image for the case where the detail is the whole point.
 */
export function LogImages({ images }: { images?: PromptImage[] }) {
  if (!images?.length) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {images.map((image) => (
        <a
          key={image.id}
          href={imageUrl(image)}
          target="_blank"
          rel="noreferrer"
          title={image.name}
          className="block w-20 h-20 rounded-md overflow-hidden border border-line bg-surface-2 hover:border-ink-3 transition-colors"
        >
          <img src={imageUrl(image)} alt={image.name} className="w-full h-full object-cover" />
        </a>
      ))}
    </div>
  );
}
