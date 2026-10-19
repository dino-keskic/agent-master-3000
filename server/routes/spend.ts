import { Express, Request, Response } from 'express';
import { IdParams, route } from '../http/app.js';
import { readOffThread } from '../opencode/readerThread.js';
import { taskStore } from '../board/taskStore.js';
import { requestCalendar } from './common.js';

/**
 * What the board is costing. Read on the OpenCode reader thread: on a large
 * database the read takes seconds, and inline it held every other request.
 *
 * This is the spend panel, so it also asks for the hourly history behind the
 * average tabs. The board snapshot does not: the header only shows this week.
 */
export function registerSpendRoutes(app: Express): void {
  app.get('/api/spend', route(async (req: Request, res: Response) => {
    const calendar = requestCalendar(req);
    res.json(
      await readOffThread('boardSpend', taskStore.getSettings().projects, Date.now(), calendar.locale, calendar.timeZone, {
        history: true
      })
    );
  }));

  // `?fresh=1` skips the cache. The drawer asks for it the moment a turn ends,
  // where a minute-old snapshot is exactly the answer the user is looking at
  // the panel to disprove. Polling reads stay cached.
  app.get('/api/tasks/:id/spend', route(async (req: Request<IdParams>, res: Response) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(
      await readOffThread('taskSpend', task, taskStore.getSettings().columns, Date.now(), { fresh: req.query.fresh === '1' })
    );
  }));
}
