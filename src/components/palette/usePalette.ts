import { useEffect, useState } from 'react';
import { isPaletteChord } from '../../../shared/palette/search';

/**
 * Whether the command palette is up, and the chord that raises it.
 *
 * The listener is on the window in the capture phase: the chord has to work
 * from inside a textarea, a Mantine modal or the transcript alike, and ⌘P has
 * to be taken before the browser opens its print sheet.
 */

export interface Palette {
  opened: boolean;
  open: () => void;
  close: () => void;
}

export function usePalette(): Palette {
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isPaletteChord(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setOpened((was) => !was);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  return {
    opened,
    open: () => setOpened(true),
    close: () => setOpened(false)
  };
}
