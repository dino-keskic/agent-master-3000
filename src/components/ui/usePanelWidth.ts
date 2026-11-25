import { useCallback, useState } from 'react';
import { PanelBounds, clampPanelWidth, parseStoredWidth } from '../../../shared/board/panelResize';

/**
 * Persisted pixel width for a resizable workspace panel, clamped to `bounds`.
 */
export function usePanelWidth(storageKey: string, bounds: PanelBounds) {
  const [width, setWidthState] = useState<number>(() => {
    try {
      return parseStoredWidth(window.localStorage.getItem(storageKey), bounds);
    } catch {
      return bounds.defaultSize;
    }
  });

  const setWidth = useCallback(
    (next: number, containerWidth?: number) => {
      const clamped = clampPanelWidth(next, bounds, containerWidth);
      setWidthState(clamped);
      try {
        window.localStorage.setItem(storageKey, String(clamped));
      } catch {
        // Private mode: keep width for this session only.
      }
    },
    [storageKey, bounds]
  );

  const reset = useCallback(() => {
    setWidth(bounds.defaultSize);
  }, [setWidth, bounds.defaultSize]);

  return { width, setWidth, reset };
}
