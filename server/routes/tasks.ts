import { Express, Request, Response } from 'express';
import { processKillSpec } from '../../shared/agent/backgroundTasks.js';
import { findColumn } from '../../shared/board/columns.js';
import { isArchived } from '../../shared/task/archive.js';
import { liveTaskSessions } from '../../shared/task/sessions.js';
import { BoardTask } from '../../shared/types.js';
import { acpManager } from '../acp/client.js';
import { resolveImages } from '../board/attachments.js';
import { IdParams, route } from '../http/app.js';
import { stripLogs } from '../live/hub.js';
import { activeRootSessionIds } from '../opencode/liveTurns.js';
import { listChildSessionIds } from '../opencode/subagents.js';
import { taskStore } from '../board/taskStore.js';
import { refreshSeededLinks } from '../trackers/promptLinks.js';
import { RouteContext } from './context.js';
import { errorMessage } from '../../shared/errors.js';

/**
 * Stop everything a task has running outside this process before it leaves the
 * board. Archiving the card cannot leave a `npm run dev` behind with nothing to
 * stop it.
 */
async function releaseTaskProcesses(task: BoardTask): Promise<void> {
  const sessionIds = liveTaskSessions(task).map((link) => link.sessionId);
  const childIds = sessionIds.flatMap((sessionId) => listChildSessionIds(sessionId));
  await acpManager.killBackgroundProcesses(processKillSpec(task, [...sessionIds, ...childIds]));
}

/**
 * Everything a task has running, stopped and unqueued: what both archiving one
 * and clearing a column have to do before the card leaves the board.
 */
async function quiesceTask(taskId: string, turns: RouteContext['turns']): Promise<void> {
  const existing = taskStore.getTask(taskId);
  if (existing) await releaseTaskProcesses(existing);
  await acpManager.closeSession(taskId);
  // A queue left behind would start turns against a task nothing can show.
  turns.clearTask(taskId);
}

/** Creating, reading, editing, archiving and restoring the cards themselves. */
export function registerTaskRoutes(app: Express, { publisher, turns, sync }: RouteContext): void {
  app.post('/api/tasks', (req: Request, res: Response) => {
    const taskInput = req.body;
    if (!taskInput.title || !taskInput.prompt) {
      return res.status(400).json({ error: 'Title and Prompt are required' });
    }
    // Whatever the client claims about an image, only the files the board
    // actually stored are kept.
    const promptImages = resolveImages(taskInput.promptImages);
    const task = taskStore.createTask({ ...taskInput, promptImages });
    refreshSeededLinks(task.links);
    res.status(201).json(publisher.updated(task));
  });

  /**
   * The recovery list. Registered before `/api/tasks/:id` so "archived" is not
   * read as a task id. Logs are stripped: the panel shows a title and a date,
   * and an archived board can hold megabytes of transcript.
   */
  app.get('/api/tasks/archived', (_req: Request, res: Response) => {
    res.json({ tasks: taskStore.listArchivedTasks().map((task) => stripLogs(task)) });
  });

  /**
   * One task with its transcript — the only response that still carries logs.
   * The drawer asks for it when a task is opened; nothing that renders a card
   * needs it, which is why lists and pushes strip it.
   */
  app.get('/api/tasks/:id', (req: Request<IdParams>, res: Response) => {
    const { id } = req.params;
    const existing = taskStore.getTask(id);
    if (!existing) return res.status(404).json({ error: 'Task not found' });

    const synced = sync.resyncTask(id);
    const task = synced?.task || existing;
    const primary = task.sessionId;
    if (
      primary
      && !turns.isStopped(primary)
      && !acpManager.isSessionTurnInFlight(primary)
      && (task.runState === 'running' || activeRootSessionIds([primary]).has(primary))
    ) {
      void acpManager.bindExistingSession(task).catch((e: unknown) => {
        console.warn(`[Server] Could not bind ${primary} while opening ${id}:`, errorMessage(e) ?? e);
      });
    }
    res.json(publisher.present(task));
  });

  app.patch('/api/tasks/:id/title', (req: Request<IdParams>, res: Response) => {
    const { title } = req.body;
    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: 'Title string is required' });
    }
    const updatedTask = taskStore.updateTask(req.params.id, { title: title.trim() });
    if (!updatedTask) return res.status(404).json({ error: 'Task not found' });
    res.json(publisher.updated(updatedTask));
  });

  app.patch('/api/tasks/:id', (req: Request<IdParams>, res: Response) => {
    const updatedTask = taskStore.updateTask(req.params.id, req.body);
    if (!updatedTask) return res.status(404).json({ error: 'Task not found' });
    res.json(publisher.updated(updatedTask));
  });

  /**
   * Off the board, not gone. The push is `deleted` because that is what the
   * board has to do with the card — drop it — and nothing a client holds is
   * true of an archived task any more; the archive panel reads its own list.
   */
  app.post('/api/tasks/:id/archive', route(async (req: Request<IdParams>, res: Response) => {
    const { id } = req.params;
    if (!taskStore.getTask(id)) return res.status(404).json({ error: 'Task not found' });

    await quiesceTask(id, turns);
    const archived = taskStore.archiveTask(id);
    if (!archived) return res.status(404).json({ error: 'Task not found' });
    publisher.deleted(id);
    res.json(archived);
  }));

  /** Back onto the board, in the column `restoreColumnId` picks. */
  app.post('/api/tasks/:id/restore', (req: Request<IdParams>, res: Response) => {
    const restored = taskStore.restoreTask(req.params.id);
    if (!restored) return res.status(404).json({ error: 'Archived task not found' });
    res.json(publisher.updated(restored));
  });

  /**
   * Permanent, and only from the archive: a task has to have been archived —
   * and so seen in the recovery list — before anything can destroy it.
   */
  app.delete('/api/tasks/:id', route(async (req: Request<IdParams>, res: Response) => {
    const { id } = req.params;
    const existing = taskStore.getTask(id);
    if (!existing) return res.status(404).json({ error: 'Task not found' });
    if (!isArchived(existing)) {
      return res.status(409).json({ error: 'Archive this task before deleting it' });
    }

    await quiesceTask(id, turns);
    if (!taskStore.deleteTask(id)) return res.status(404).json({ error: 'Task not found' });
    publisher.deleted(id);
    res.json({ success: true });
  }));

  /** Clearing a column archives what is in it; nothing here is destroyed. */
  app.delete('/api/columns/:id/tasks', route(async (req: Request<IdParams>, res: Response) => {
    const { id } = req.params;
    if (!findColumn(taskStore.getSettings().columns, id)) {
      return res.status(404).json({ error: 'Column not found' });
    }
    const ids = taskStore.liveTaskIdsInColumn(id);
    await Promise.allSettled(ids.map((taskId) => quiesceTask(taskId, turns)));
    const archived = taskStore.archiveTasksInColumn(id);
    for (const taskId of archived) publisher.deleted(taskId);
    res.json({ success: true, archived });
  }));
}
