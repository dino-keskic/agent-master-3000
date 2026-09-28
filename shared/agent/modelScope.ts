import { shortModelLabel } from '../format.js';
import { OpenCodeModel } from '../sessions/types.js';

/**
 * One model list for the whole board, out of one per project folder.
 *
 * OpenCode offers a model in a folder when some config layer that folder
 * loads defines it: the global config for all of them, a project's own
 * `opencode.json` for that project alone. The board's dropdowns are one list,
 * so the lists are merged and a model that only some folders have says which.
 *
 * The client loads this too, so no `path`: folders arrive absolute and are
 * compared with their trailing separators dropped.
 */

function clean(folder: string): string {
  return folder.length > 1 ? folder.replace(/[\\/]+$/, '') : folder;
}

function baseName(folder: string): string {
  return clean(folder).split(/[\\/]/).pop() || folder;
}

export interface FolderModels {
  folder: string;
  models: readonly OpenCodeModel[];
}

/**
 * Every model any folder offers, in the order the folders were given and then
 * the order each lists them. `onlyIn` is set on a model some of the folders
 * lack; a folder that could not be read does not count against anyone.
 */
export function mergeFolderModels(lists: readonly FolderModels[]): OpenCodeModel[] {
  const byId = new Map<string, { model: OpenCodeModel; folders: string[] }>();
  for (const { folder, models } of lists) {
    for (const model of models) {
      const seen = byId.get(model.id);
      if (seen) {
        if (!seen.folders.includes(folder)) seen.folders.push(folder);
      } else {
        byId.set(model.id, { model: { id: model.id, name: model.name, provider: model.provider }, folders: [folder] });
      }
    }
  }
  const everywhere = new Set(lists.map((l) => l.folder)).size;
  return [...byId.values()].map(({ model, folders }) =>
    folders.length < everywhere ? { ...model, onlyIn: folders } : model
  );
}

/**
 * "only in api, web" for a model a project brings, naming the board's
 * projects where it can; undefined for one every project has.
 */
export function modelScopeLabel(
  model: Pick<OpenCodeModel, 'onlyIn'>,
  projects: readonly { name: string; path: string }[]
): string | undefined {
  if (!model.onlyIn?.length) return undefined;
  const names = model.onlyIn.map((folder) =>
    projects.find((p) => clean(p.path) === clean(folder))?.name || baseName(folder)
  );
  return `only in ${names.join(', ')}`;
}

/** Whether a session in `folder` can run `model`. */
export function modelOfferedIn(model: Pick<OpenCodeModel, 'onlyIn'>, folder: string): boolean {
  if (!model.onlyIn) return true;
  const target = clean(folder);
  return model.onlyIn.some((dir) => target === clean(dir) || target.startsWith(clean(dir) + '/') || target.startsWith(clean(dir) + '\\'));
}

/** Every model with its `scope` named after the board's projects. */
export function withModelScopes(
  models: readonly OpenCodeModel[],
  projects: readonly { name: string; path: string }[]
): OpenCodeModel[] {
  return models.map((model) => {
    const scope = modelScopeLabel(model, projects);
    return scope ? { ...model, scope } : model;
  });
}

/** A model as a picker lists it: its short name, and where it is offered when not everywhere. */
export function modelOptionLabel(model: Pick<OpenCodeModel, 'id' | 'name' | 'scope'>): string {
  const label = shortModelLabel(model.id, model.name);
  return model.scope ? `${label} (${model.scope})` : label;
}
