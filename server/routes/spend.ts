import { Express, Request, Response } from 'express';
import { IdParams } from '../http/app.js';
import { boardSpend, taskSpend } from '../opencode/spend.js';
import { taskStore } from '../board/taskStore.js';
import { requestCalendar } from './common.js';

/**
 * What the board is costing. Served from spendStore's cache — the underlying
 * read is half a second, so it is never done on a path the board waits on.
 *
 * This is the spend panel, so it also asks for the hourly history behind the
 * average tabs. The board snapshot does not: the header only shows this week.
 */
export function registerSpendRoutes(app: Express): void {
  app.get('/api/spend', (req: Request, res: Response) => {
    const calendar = requestCalendar(req);
    res.json(
      boardSpend(taskStore.getSettings().projects, Date.now(), calendar.locale, calendar.timeZone, {
        history: true
      })
    );
  });

  // `?fresh=1` skips the cache. The drawer asks for it the moment a turn ends,
  // where a minute-old snapshot is exactly the answer the user is looking at
  // the panel to disprove. Polling reads stay cached.
  app.get('/api/tasks/:id/spend', (req: Request<IdParams>, res: Response) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(taskSpend(task, taskStore.getSettings().columns, Date.now(), { fresh: req.query.fresh === '1' }));
  });
}
