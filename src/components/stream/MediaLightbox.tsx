import React from 'react';
import { Modal } from '@mantine/core';
import { ExternalLink, X } from 'lucide-react';

/**
 * Full-size image viewer modal for transcript attachments and inline markdown images.
 *
 * Keeps image inspection inside the app on both Electron desktop and mobile
 * browsers while still offering a one-click open-in-new-tab action.
 */

export interface MediaLightboxProps {
  opened: boolean;
  onClose: () => void;
  src: string;
  name?: string;
  caption?: string;
}

export const MediaLightbox: React.FC<MediaLightboxProps> = ({
  opened,
  onClose,
  src,
  name,
  caption
}) => {
  const title = name || 'Image';

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      size="auto"
      padding="xs"
      withCloseButton={false}
      aria-label={title}
    >
      <div className="flex flex-col gap-2 max-w-[92vw]">
        <div className="flex items-center justify-between gap-3 px-1">
          <span className="font-mono text-xs text-ink-2 truncate">{title}</span>
          <div className="flex items-center gap-1 shrink-0">
            {src && (
              <a
                href={src}
                target="_blank"
                rel="noreferrer noopener"
                title="Open in new tab"
                aria-label="Open in new tab"
                className="p-1 rounded text-ink-3 hover:text-ink hover:bg-s3h transition-colors inline-flex items-center"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              title="Close"
              aria-label="Close"
              className="p-1 rounded text-ink-3 hover:text-ink hover:bg-s3h transition-colors inline-flex items-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {opened && src && (
          <img
            src={src}
            alt={title}
            className="block max-h-[80vh] max-w-[90vw] object-contain rounded border border-line bg-surface-2 mx-auto"
          />
        )}

        {caption && (
          <p className="text-xs text-ink-3 px-1 max-w-[90vw] whitespace-pre-wrap">{caption}</p>
        )}
      </div>
    </Modal>
  );
};
