import { Express, Request, Response } from 'express';
import { NewTaskLink } from '../../shared/task/links.js';
import { IdParams, LinkParams } from '../http/app.js';
import { kickLinkStatusRefresh } from '../trackers/linkStatus.js';
import { taskStore } from '../board/taskStore.js';
import { respondWithTask } from './common.js';
import { RouteContext } from './context.js';

/**
 * The loose shapes a link write arrives in: one `{ url }`, a list of them, or a
 * bare URL string. The MCP tool and the sidebar's add box both land here, and
 * an agent that passes a string instead of an object should not get an error
 * back for something the board understood perfectly well.
 */
function parseLinkInputs(payload: unknown): NewTaskLink[] {
  const raw: unknown[] = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object'
      ? [payload]
      : typeof payload === 'string'
        ? [payload]
        : [];
  const inputs: NewTaskLink[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      if (entry.trim()) inputs.push({ url: entry });
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const url = typeof item.url === 'string' ? item.url : typeof item.link === 'string' ? item.link : '';
    if (!url.trim()) continue;
    inputs.push({
      url,
      title: typeof item.title === 'string' ? item.title : undefined,
      note: typeof item.note === 'string' ? item.note : typeof item.description === 'string' ? item.description : undefined
    });
  }
  return inputs;
}

function parseLinkSource(value: unknown): 'user' | 'agent' {
  return value === 'agent' ? 'agent' : 'user';
}

/** Tickets, PRs and pages pinned to a task. */
export function registerLinkRoutes(app: Express, { publisher }: RouteContext): void {
  app.get('/api/tasks/:id/links', (req: Request<IdParams>, res: Response) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ links: task.links || [] });
  });

  app.post('/api/tasks/:id/links', (req: Request<IdParams>, res: Response) => {
    if (!taskStore.getTask(req.params.id)) return res.status(404).json({ error: 'Task not found' });
    const payload = req.body as { links?: unknown; url?: unknown; source?: unknown };
    const inputs = parseLinkInputs(payload?.links ?? payload);
    if (inputs.length === 0) return res.status(400).json({ error: 'links must carry at least one url' });

    const outcome = taskStore.addTaskLinks(req.params.id, inputs, parseLinkSource(payload?.source));
    if (!outcome) return res.status(404).json({ error: 'Task not found' });
    const changed = outcome.result.added.length > 0 || outcome.result.updated.length > 0;
    const live = changed ? publisher.updated(outcome.task) : publisher.present(outcome.task);
    if (changed) kickLinkStatusRefresh();
    res.json({
      added: outcome.result.added,
      updated: outcome.result.updated,
      rejected: outcome.rejected,
      links: live.links || [],
      task: live
    });
  });

  app.patch('/api/tasks/:id/links/:linkId', (req: Request<LinkParams>, res: Response) => {
    if (!taskStore.getTask(req.params.id)) return res.status(404).json({ error: 'Task not found' });
    const { title, note } = req.body as { title?: string; note?: string };
    const updated = taskStore.updateTaskLink(req.params.id, req.params.linkId, { title, note });
    respondWithTask(publisher, res, updated, 'Link not found');
  });

  app.delete('/api/tasks/:id/links/:linkId', (req: Request<LinkParams>, res: Response) => {
    if (!taskStore.getTask(req.params.id)) return res.status(404).json({ error: 'Task not found' });
    const updated = taskStore.deleteTaskLink(req.params.id, req.params.linkId);
    respondWithTask(publisher, res, updated, 'Link not found');
  });
}
