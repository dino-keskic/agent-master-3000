import { Express, Request, Response } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { IdParams } from '../http/app.js';
import { directoryExists } from '../opencode/db.js';
import { listFolderActivity } from '../opencode/folderActivity.js';
import { suggestProjects } from '../../shared/setup/onboarding.js';
import { rememberProjects } from '../opencode/hydrate.js';
import { sanitizeColumnPrompts } from '../../shared/board/projectColumnPrompts.js';
import { taskStore } from '../board/taskStore.js';
import { RouteContext } from './context.js';

/** How many folders the welcome screen offers. More is a list to read, not a choice. */
const MAX_SUGGESTIONS = 8;

/**
 * A folder typed or pasted by hand, as the absolute path it names. The native
 * picker never needs this; a path pasted on a machine without one does, and
 * `~` is how people write their home folder.
 */
function typedFolder(raw: string): string | undefined {
  const expanded = raw === '~' || raw.startsWith('~/') ? path.join(os.homedir(), raw.slice(1)) : raw;
  // Relative to what? The server's own folder is no answer the user can see.
  return path.isAbsolute(expanded) ? path.resolve(expanded) : undefined;
}

/** The folders the user has added to the board. */
export function registerProjectRoutes(app: Express, { publisher }: RouteContext): void {
  app.get('/api/projects', (_req: Request, res: Response) => {
    res.json(taskStore.getSettings().projects);
  });

  /**
   * The per-project column instructions, written for every project the column
   * editor touched in one go. One call rather than one per project: saving the
   * columns and the instructions the user wrote against them is a single edit,
   * and a half-applied one would leave a column referring to rules that were
   * never stored. A project absent from the body is left alone.
   */
  app.post('/api/projects/column-prompts', (req: Request, res: Response) => {
    const { prompts } = req.body as { prompts?: Record<string, unknown> };
    if (!prompts || typeof prompts !== 'object') {
      return res.status(400).json({ error: 'prompts must be an object keyed by project id' });
    }

    const projects = taskStore.getSettings().projects.map((project) =>
      Object.prototype.hasOwnProperty.call(prompts, project.id)
        ? { ...project, columnPrompts: sanitizeColumnPrompts(prompts[project.id]) }
        : project
    );
    taskStore.updateSettings({ projects });
    rememberProjects(taskStore.getSettings().projects);
    publisher.projects(taskStore.getSettings().projects);
    res.json(taskStore.getSettings().projects);
  });

  /** The folders OpenCode has sessions in that the board does not have yet. */
  app.get('/api/projects/suggestions', (_req: Request, res: Response) => {
    res.json(suggestProjects(listFolderActivity(), {
      projects: taskStore.getSettings().projects,
      home: os.homedir(),
      exists: directoryExists,
      limit: MAX_SUGGESTIONS
    }));
  });

  app.post('/api/projects', (req: Request, res: Response) => {
    const { name } = req.body;
    const raw = typeof req.body?.path === 'string' ? req.body.path.trim() : '';
    if (!raw) return res.status(400).json({ error: 'Folder path is required' });
    // Every task in a project runs there, so a folder that is not there would
    // only fail later, on the first turn, with a less useful message.
    const folderPath = typedFolder(raw);
    if (!folderPath) return res.status(400).json({ error: 'Give the full path to the folder, starting with / or ~' });
    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
      return res.status(400).json({ error: `There is no folder at ${folderPath}` });
    }
    const project = taskStore.addProject(name, folderPath);
    rememberProjects(taskStore.getSettings().projects);
    publisher.projects(taskStore.getSettings().projects);
    res.status(201).json(project);
  });

  app.delete('/api/projects/:id', (req: Request<IdParams>, res: Response) => {
    const deleted = taskStore.deleteProject(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Project not found' });
    rememberProjects(taskStore.getSettings().projects);
    publisher.projects(taskStore.getSettings().projects);
    res.json({ success: true });
  });
}
