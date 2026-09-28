/** Where the board keeps its data and finds OpenCode — first run and Settings. */

import type { LocationCheck, LocationKey, SetupPatch, SetupReport, SetupSaveResult } from '../../shared/setup/report';
import type { PickFolderResult } from './projects';
import { post, request } from './http';

export const setupApi = {
  /** Where the board and OpenCode are, and whether each is there. */
  setup: () => request<SetupReport>('/api/setup'),

  /** One typed path, cleaned up and judged, without saving it. */
  checkLocation: (key: LocationKey, value: string) => post<LocationCheck>('/api/setup/check', { key, value }),

  saveSetup: (change: SetupPatch) =>
    request<SetupSaveResult>('/api/setup', { method: 'PUT', body: JSON.stringify(change) }),

  /** The native picker, for a file or a folder, opened near `startPath`. */
  pickPath: (kind: 'file' | 'folder', startPath: string) => post<PickFolderResult>('/api/setup/pick', { kind, startPath })
};
