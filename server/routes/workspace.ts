import { execFile } from 'child_process';
import { Express, Request, Response } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { TaskChangeSummary } from '../../shared/git/changeSummary.js';
import { taskTicket, ticketInText } from '../../shared/task/links.js';
import { listTaskSessions, sessionCwd } from '../../shared/task/sessions.js';
import { taskWorkspaces } from '../../shared/task/workspaces.js';
import { boardRoots, transcriptsNamePath } from '../board/queries.js';
import { summarizeTaskWorkspaces } from '../git/changeSummary.js';
import { DiffScope, taskDiff } from '../git/diff.js';
import { mapLimit } from '../../shared/mapLimit.js';
import { createTaskWorktree, gitInfo, listWorktrees } from '../git/worktree.js';
import { IdParams, route } from '../http/app.js';
import { EDITORS, EditorId, absoluteTarget, availableEditors, isEditorId, openInEditor, resolveWithinRoots } from '../app/openExternal.js';
import { taskStore } from '../board/taskStore.js';
import { queryString } from './common.js';
import { errorField, errorMessage } from '../../shared/errors.js';

const execFileAsync = promisify(execFile);

/**
 * How many folders one task's diff will read. A task spans a handful of
 * repositories at most; the cap is there so a task that somehow collected
 * dozens of sessions cannot turn one tab into dozens of git invocations.
 */
const MAX_DIFF_FOLDERS = 8;

/**
 * How many tasks one summary fetch covers. A board holds dozens of tasks;
 * the cap is there so a hostile query string cannot turn one request into
 * hundreds of git invocations.
 */
const MAX_SUMMARY_TASKS = 50;

/** How many of those tasks may run git at once. Worktrees share a git dir. */
const SUMMARY_CONCURRENCY = 2;

/** The AppleScript behind the native folder picker. */
function chooseFolderScript(startPath: string): string {
  return [
    `set startLocation to POSIX file ${JSON.stringify(startPath)}`,
    'tell application "System Events"',
    '  activate',
    '  set chosenFolder to choose folder with prompt "Select project folder" default location startLocation',
    'end tell',
    'return POSIX path of chosenFolder'
  ].join('\n');
}

/** The filesystem and git side of the board: folders, worktrees, diffs, editors. */
export function registerWorkspaceRoutes(app: Express): void {
  app.post('/api/fs/pick-folder', route(async (req: Request, res: Response) => {
    if (process.platform !== 'darwin') {
      return res.status(501).json({ error: 'The native folder picker requires macOS' });
    }

    const requested = typeof req.body?.startPath === 'string' ? req.body.startPath : '';
    const startPath = requested && fs.existsSync(requested) ? requested : os.homedir();

    try {
      const { stdout } = await execFileAsync('osascript', ['-e', chooseFolderScript(startPath)]);
      const trimmed = stdout.trim();
      const folderPath = trimmed.length > 1 ? trimmed.replace(/\/+$/, '') : trimmed;
      if (!folderPath) return res.status(400).json({ error: 'No folder selected' });
      res.json({ path: folderPath, name: path.basename(folderPath) || folderPath });
    } catch (e) {
      const detail = errorField(e, 'stderr') || errorMessage(e) || '';
      if (detail.includes('-128') || /user canceled/i.test(detail)) {
        return res.json({ cancelled: true });
      }
      console.error('[FS] Folder picker failed:', detail.trim());
      res.status(500).json({ error: detail.trim() || 'Failed to open the folder picker' });
    }
  }));

  app.get('/api/fs/git-info', route(async (req: Request, res: Response) => {
    res.json(await gitInfo(queryString(req, 'cwd')));
  }));

  app.get('/api/worktrees', route(async (req: Request, res: Response) => {
    res.json(await listWorktrees(queryString(req, 'cwd')));
  }));

  /**
   * Cut a worktree for a piece of work.
   *
   * `name` is whatever describes the work — a title, or the prompt it was
   * typed as. The ticket is what actually names the branch when there is one,
   * so it is looked up here rather than trusted from the caller: the task the
   * board holds is the truth about which ticket the work is against, and a task
   * that does not exist yet still has its ticket written in the text.
   */
  app.post('/api/worktrees', route(async (req: Request, res: Response) => {
    const cwd = typeof req.body?.cwd === 'string' ? req.body.cwd : '';
    const name = typeof req.body?.name === 'string' ? req.body.name : '';
    const taskId = typeof req.body?.taskId === 'string' ? req.body.taskId : '';
    if (!cwd) return res.status(400).json({ error: 'cwd is required' });
    const task = taskId ? taskStore.getTask(taskId) : undefined;
    const ticket = (task ? taskTicket(task.links) : undefined) || ticketInText(name);
    try {
      const created = await createTaskWorktree(cwd, { name, ticket });
      res.status(201).json(created);
    } catch (e) {
      res.status(400).json({ error: errorMessage(e) || 'Could not create worktree' });
    }
  }));

  /**
   * What a task changed — in every folder it works in.
   *
   * The sessions of one task can sit in different projects and different
   * checkouts, so this reads each of those folders and answers with a diff per
   * folder rather than one diff. They are read together: a task in three
   * repositories should not take three times as long to show.
   */
  app.get('/api/tasks/:id/diff', route(async (req: Request<IdParams>, res: Response) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const scope: DiffScope = req.query.scope === 'branch' ? 'branch' : 'uncommitted';
    const sessionId = typeof req.query.session === 'string' ? req.query.session : undefined;
    const link = sessionId ? listTaskSessions(task).find((item) => item.sessionId === sessionId) : undefined;

    const workspaces = taskWorkspaces(
      task,
      taskStore.getSettings().projects,
      link ? sessionCwd(task, link) : undefined
    ).slice(0, MAX_DIFF_FOLDERS);

    if (workspaces.length === 0) {
      // No folder at all: still answer in the shape the tab reads, saying why.
      const empty = await taskDiff('', scope);
      return res.json({ scope, workspaces: [{ ...empty, label: '', isWorktree: false, isTaskFolder: true, sessionIds: [] }] });
    }

    res.json({
      scope,
      workspaces: await Promise.all(
        workspaces.map(async (workspace) => ({ ...workspace, ...(await taskDiff(workspace.cwd, scope)) }))
      )
    });
  }));

  /**
   * The change summary behind every card, in one round trip.
   *
   * This stays off the board snapshot on purpose: snapshots stream several
   * times a second while a turn runs, and a summary is a numstat read per
   * folder. The board fetches this on its own cadence instead. Unknown ids
   * are skipped rather than rejected — a card can archive between the
   * snapshot and this fetch. Tasks run a few at a time so a full board does
   * not start one git per card in the same instant.
   */
  app.get('/api/change-summaries', route(async (req: Request, res: Response) => {
    const ids = queryString(req, 'ids')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, MAX_SUMMARY_TASKS);
    const projects = taskStore.getSettings().projects;
    const entries = await mapLimit(ids, SUMMARY_CONCURRENCY, async (id) => {
      const task = taskStore.getTask(id);
      if (!task) return undefined;
      const workspaces = taskWorkspaces(task, projects).slice(0, MAX_DIFF_FOLDERS);
      return [id, await summarizeTaskWorkspaces(workspaces)] as const;
    });
    const summaries = Object.fromEntries(
      entries.filter((entry): entry is readonly [string, TaskChangeSummary] => !!entry)
    );
    res.json({ summaries });
  }));

  app.get('/api/editors', route(async (_req: Request, res: Response) => {
    const installed = new Set(await availableEditors());
    res.json(
      Object.entries(EDITORS)
        .filter(([id]) => installed.has(id as EditorId))
        .map(([id, spec]) => ({ id, label: spec.label }))
    );
  }));

  app.post('/api/open', route(async (req: Request, res: Response) => {
    const editor = req.body?.editor;
    const target = typeof req.body?.target === 'string' ? req.body.target : '';
    const rawLine = Number(req.body?.line);
    const line = Number.isFinite(rawLine) && rawLine > 0 ? Math.floor(rawLine) : undefined;

    if (!isEditorId(editor)) return res.status(400).json({ error: 'Unknown editor' });

    // Inside a board folder, or named by an agent in a transcript — a file the
    // agent talked about is one the user can open, wherever it happens to live.
    const taskId = typeof req.body?.taskId === 'string' ? req.body.taskId : undefined;
    const named = absoluteTarget(target);
    const resolved =
      resolveWithinRoots(target, boardRoots()) ||
      (named && transcriptsNamePath(named, taskId) ? named : undefined);

    if (!resolved) {
      return res.status(403).json({
        error: 'That path is outside every folder on the board, and no transcript mentions it'
      });
    }

    try {
      await openInEditor({ editor, target: resolved, line });
      res.json({ success: true, opened: resolved });
    } catch (e) {
      res.status(400).json({ error: errorMessage(e) || 'Could not open that path' });
    }
  }));
}
