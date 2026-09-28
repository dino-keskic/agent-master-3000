import { useCallback, useState } from 'react';
import { BoardTask, ProjectFolder } from '../../shared/types';
import { needsOnboarding } from '../../shared/setup/onboarding';

/**
 * Whether the board greets the user instead of showing itself, and which step
 * of the greeting they are on.
 *
 * The first step is where things are — the data folder, OpenCode — so a
 * machine where they are somewhere unusual is fixed before anything runs.
 *
 * It switches on the moment the board is seen empty and stays on until the
 * user is done with it, not merely until a project exists: adding the first
 * project is what makes the second step — bringing that folder's sessions
 * over — worth asking, so the board must not appear the instant it lands.
 */

export interface Onboarding {
  showing: boolean;
  /** Past the first step, which checks where the data and OpenCode are. */
  locationsConfirmed: boolean;
  confirmLocations: () => void;
  /** The project just added; set once the first step is done. */
  project?: ProjectFolder;
  finish: () => void;
}

export function useOnboarding(
  hasLoaded: boolean,
  projects: ProjectFolder[],
  tasks: BoardTask[],
  selectedProjectId: string | undefined
): Onboarding {
  const [active, setActive] = useState(false);
  const [locationsConfirmed, setLocationsConfirmed] = useState(false);
  // Latched while rendering, so no frame shows an empty board first. Only
  // once the board has loaded: before that the lists are empty because
  // nothing has arrived, and a latch set then would greet every reload of a
  // board that has projects.
  if (!active && hasLoaded && needsOnboarding(projects, tasks)) setActive(true);

  const finish = useCallback(() => setActive(false), []);
  const confirmLocations = useCallback(() => setLocationsConfirmed(true), []);
  // Adding a project selects it, so the selection is the one just added.
  const project = projects.find((p) => p.id === selectedProjectId) || projects[projects.length - 1];

  return {
    showing: active,
    locationsConfirmed,
    confirmLocations,
    project: active ? project : undefined,
    finish
  };
}
