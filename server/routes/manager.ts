import { Express, Request, Response } from 'express';
import { MANAGER_BRIEFING } from '../../shared/manager/briefing.js';
import { boardDigest, taskDetail } from '../../shared/manager/digest.js';
import { MANAGER_TASK_ID, MANAGER_TITLE } from '../../shared/manager/identity.js';
import { isArchived } from '../../shared/task/archive.js';
import { IdParams } from '../http/app.js';
import { taskStore } from '../board/taskStore.js';
import { RouteContext } from './context.js';

/**
 * The manager: the one task that talks about all the others.
 *
 * `POST /api/manager` is what the header's button calls — it opens the manager
 * there is, or makes one and sends it its briefing. The two reads are what its
 * board tools (`server/mcp/`) are made of; what they mean is
 * `shared/manager/digest.ts`.
 */
export function registerManagerRoutes(app: Express, { publisher, orchestrator }: RouteContext): void {
  app.post('/api/manager', (_req: Request, res: Response) => {
    const existing = taskStore.getTask(MANAGER_TASK_ID);
    if (existing) {
      // Archived from its drawer, most likely; there is only ever one manager.
      const task = isArchived(existing) ? taskStore.restoreTask(MANAGER_TASK_ID) || existing : existing;
      return res.json(publisher.updated(task));
    }

    const task = taskStore.createTask({ id: MANAGER_TASK_ID, title: MANAGER_TITLE, prompt: MANAGER_BRIEFING });
    void orchestrator.start(task.id, MANAGER_BRIEFING, {});
    res.status(201).json(publisher.updated(taskStore.getTask(task.id) || task));
  });

  app.get('/api/manager/overview', (_req: Request, res: Response) => {
    res.json(boardDigest(taskStore.listLiveTasks(), taskStore.getSettings().columns, Date.now()));
  });

  app.get('/api/manager/tasks/:id', (req: Request<IdParams>, res: Response) => {
    const task = taskStore.getTask(req.params.id);
    if (!task || isArchived(task)) return res.status(404).json({ error: `No task ${req.params.id} on the board` });
    const turns = Number(req.query.turns);
    const limit = Number.isFinite(turns) && turns > 0 ? Math.min(Math.floor(turns), 30) : undefined;
    res.json({ ...taskDetail(task, taskStore.getSettings().columns, limit), now: Date.now() });
  });
}
