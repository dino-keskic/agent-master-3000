import React from 'react';
import { Group, Loader, Text } from '@mantine/core';
import { X } from 'lucide-react';
import { PromptImage, imageUrl } from '../../../shared/composer/promptImages';

/**
 * The pictures riding along with the prompt being written, as thumbnails.
 *
 * Each one is the file the agent will actually be handed, served back from the
 * board's own attachment store — so a thumbnail that renders is proof the
 * upload landed, and one that does not is the failure, visible before the turn
 * is sent rather than after.
 */

interface PromptImageStripProps {
  images: PromptImage[];
  uploading: boolean;
  error?: string;
  onRemove: (id: string) => void;
  disabled?: boolean;
}

export const PromptImageStrip: React.FC<PromptImageStripProps> = ({
  images,
  uploading,
  error,
  onRemove,
  disabled
}) => {
  if (images.length === 0 && !uploading && !error) return null;

  return (
    <div className="px-0.5">
      <Group gap={6} wrap="wrap" align="center">
        {images.map((image) => (
          <div
            key={image.id}
            className="relative w-14 h-14 rounded-md overflow-hidden border border-line bg-surface-2 group"
            title={image.name}
          >
            <img src={imageUrl(image)} alt={image.name} className="w-full h-full object-cover" />
            <button
              type="button"
              disabled={disabled}
              onClick={() => onRemove(image.id)}
              aria-label={`Remove ${image.name}`}
              title={`Remove ${image.name}`}
              className="absolute top-0.5 right-0.5 rounded-full bg-canvas/80 text-ink-2 p-[2px] opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity hover:text-ink"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}

        {uploading && (
          <Group gap={5} className="h-14 px-1">
            <Loader size={12} />
            <Text size="10px" className="font-mono text-ink-3">Attaching…</Text>
          </Group>
        )}
      </Group>

      {error && (
        <Text size="10px" className="font-mono text-wait-fg pt-1">
          {error}
        </Text>
      )}
    </div>
  );
};
