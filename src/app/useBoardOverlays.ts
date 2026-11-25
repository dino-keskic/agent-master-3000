import { useState } from 'react';
import { StudioSection } from '../components/studio/StudioPage';

/**
 * The panels that sit over the board: importing a session, editing the columns,
 * what the week cost, the archive tasks are recovered from, the settings, and
 * the full-screen studio pages (Tools, Agents, Skills).
 *
 * Each is opened from the header or palette and closed from itself, so the flag
 * has to live above both. The notification panel and the task drawer are not
 * here — they belong to the inbox and the selected task, which own more than a
 * flag.
 */

export interface Overlay {
  opened: boolean;
  open: () => void;
  close: () => void;
}

/** The import list, which can open already narrowed to one project. */
export interface ImportOverlay extends Overlay {
  projectId?: string;
  openFor: (projectId: string) => void;
}

/** Full-screen Tools, Agents, and Skills pages. */
export interface StudioOverlay {
  opened: boolean;
  section: StudioSection | null;
  openPage: (section: StudioSection) => void;
  close: () => void;
}

export interface BoardOverlayState {
  sessionImport: ImportOverlay;
  columnEditor: Overlay;
  spend: Overlay;
  comments: Overlay;
  archive: Overlay;
  settings: Overlay;
  studio: StudioOverlay;
}

function useOverlay(onOpen?: () => void): Overlay {
  const [opened, setOpened] = useState(false);
  return {
    opened,
    open: () => {
      setOpened(true);
      onOpen?.();
    },
    close: () => setOpened(false)
  };
}

function useImportOverlay(): ImportOverlay {
  const [opened, setOpened] = useState(false);
  const [projectId, setProjectId] = useState<string>();
  return {
    opened,
    projectId,
    open: () => {
      setProjectId(undefined);
      setOpened(true);
    },
    openFor: (id) => {
      setProjectId(id);
      setOpened(true);
    },
    close: () => setOpened(false)
  };
}

function useStudioOverlay(): StudioOverlay {
  const [section, setSection] = useState<StudioSection | null>(null);
  return {
    opened: section !== null,
    section,
    openPage: (next) => setSection(next),
    close: () => setSection(null)
  };
}

/**
 * `onOpenSpend` and `onOpenSettings` run when those panels open, to fetch
 * what they show fresh.
 */
export function useBoardOverlays(onOpenSpend: () => void, onOpenSettings: () => void): BoardOverlayState {
  return {
    sessionImport: useImportOverlay(),
    columnEditor: useOverlay(),
    spend: useOverlay(onOpenSpend),
    comments: useOverlay(),
    archive: useOverlay(),
    settings: useOverlay(onOpenSettings),
    studio: useStudioOverlay()
  };
}
