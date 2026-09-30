import { Express, Request, Response } from 'express';
import { findColumn } from '../../shared/board/columns.js';
import { resolveProjectRunPrompt } from '../../shared/board/projectColumnPrompts.js';
import { resolveImages } from '../board/attachments.js';
import { IdParams, route } from '../http/app.js';
import { taskStore } from '../board/taskStore.js';
import { liftPromptLinks } from '../trackers/promptLinks.js';
import { RouteContext } from './context.js';

/**
 * Starting and stopping a turn.
 *
 * Every route here hands off to the orchestrator and answers immediately with
 * the task as it stands: a turn outlives the request that asked for it, and its
 * output arrives over the websocket. Moving between columns is in
 * `taskMove.ts`, and answering a blocked agent in `respond.ts`.
 */
export function registerTaskRunRoutes(app: Express, { publisher, orchestrator, turns }: RouteContext): void {
  app.post('/api/tasks/:id/run', route(async (req: Request<IdParams>, res: Response) => {
    const { id } = req.params;
    const { prompt } = req.body as { prompt?: string };

    const task = taskStore.getTask(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const column = findColumn(taskStore.getSettings().columns, task.columnId);
    // Images dropped into the header belong to the prompt the task was written
    // with, so they ride along the first time that prompt is sent and never
    // again: by the second turn the session has already seen them.
    const images = task.sessionId ? [] : (task.promptImages || []);
    void orchestrator.start(
      id,
      resolveProjectRunPrompt(column, task, taskStore.getSettings().projects, prompt),
      { columnId: task.columnId, images }
    );
    res.json(publisher.present(taskStore.getTask(id) || task));
  }));

  /** Summarize the conversation so the session can keep going with a smaller context. */
  app.post('/api/tasks/:id/compact', route(async (req: Request<IdParams>, res: Response) => {
    const { id } = req.params;
    const task = taskStore.getTask(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!task.sessionId) {
      return res.status(400).json({ error: 'This task has no OpenCode session to compact yet' });
    }
    if (orchestrator.isTurnBusy(id, task.sessionId)) {
      return res.status(409).json({ error: 'A turn is already running — stop it before compacting' });
    }

    void orchestrator.compact(id, task.sessionId).catch((e: unknown) => {
      console.error(`[Server] Compact failed for ${id}:`, e);
    });
    res.json(publisher.present(taskStore.getTask(id) || task));
  }));

  app.post('/api/tasks/:id/prompt', route(async (req: Request<IdParams>, res: Response) => {
    const { id } = req.params;
    const { prompt, images } = req.body as { prompt?: string; images?: unknown };
    const attached = resolveImages(images);
    if (!prompt && attached.length === 0) return res.status(400).json({ error: 'Prompt is required' });

    const task = taskStore.getTask(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    liftPromptLinks(id, prompt, publisher);
    void orchestrator.start(id, prompt || '', { images: attached });
    res.json(publisher.present(taskStore.getTask(id) || task));
  }));

  /**
   * Take back a prompt that has not started yet. Typing ahead is only safe if it
   * can be undone — otherwise a queue is a list of sends the user is committed to.
   */
  app.delete('/api/tasks/:id/queued/:queuedId', route(async (req: Request<{ id: string; queuedId: string }>, res: Response) => {
    const { id, queuedId } = req.params;
    const task = taskStore.getTask(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    if (!turns.remove(queuedId, id)) {
      return res.status(404).json({ error: 'That prompt is no longer queued — it may have already started' });
    }
    res.json(publisher.updated(task));
  }));

  app.post('/api/tasks/:id/stop', route(async (req: Request<IdParams>, res: Response) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(await orchestrator.stopTask(task));
  }));
}
