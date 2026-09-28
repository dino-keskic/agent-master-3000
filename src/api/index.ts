/**
 * The client's server API, one object for the whole app.
 *
 * Each feature file beside this one owns its calls and the types they carry;
 * this merges them so a component writes `api.getTask(...)` without knowing
 * which file that lives in. `http.ts` is how every call is made.
 */

import { boardApi } from './board';
import { composerApi } from './composer';
import { diffApi } from './diff';
import { editorsApi } from './editors';
import { linksApi } from './links';
import { projectsApi } from './projects';
import { reviewApi } from './review';
import { sessionsApi } from './sessions';
import { setupApi } from './setup';
import { spendApi } from './spend';
import { tasksApi } from './tasks';
import { toolsApi } from './tools';

export { ApiError } from './http';
export type { BoardResponse, ConfigOptionsResponse } from './board';
export type { DiffScope, TaskDiff, TaskDiffs, WorkspaceDiff } from './diff';
export type { EditorOption } from './editors';
export type { CreatedWorktree, GitInfo, PickFolderResult } from './projects';
export type { SessionQuery, StartSessionInput } from './sessions';
export type { MovedTask, MoveTargetInput } from './tasks';

export const api = {
  ...boardApi,
  ...projectsApi,
  ...setupApi,
  ...composerApi,
  ...tasksApi,
  ...sessionsApi,
  ...diffApi,
  ...toolsApi,
  ...reviewApi,
  ...linksApi,
  ...spendApi,
  ...editorsApi
};
