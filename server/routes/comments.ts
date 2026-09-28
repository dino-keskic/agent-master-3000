import { Express, Request, Response } from 'express';
import { normalizeChangelogResponses } from '../../shared/review/agentResponses.js';
import { ChangelogAuthor } from '../../shared/types.js';
import { CommentParams, IdParams } from '../http/app.js';
import { taskStore } from '../board/taskStore.js';
import { respondWithTask } from './common.js';
import { RouteContext } from './context.js';

function parseAuthor(value: unknown): ChangelogAuthor {
  return value === 'agent' ? 'agent' : 'user';
}

/** Review comments left on a task's changelog — by the user or by the agent. */
export function registerCommentRoutes(app: Express, { publisher }: RouteContext): void {
  app.get('/api/tasks/:id/comments', (req: Request<IdParams>, res: Response) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ comments: task.changelogComments || [] });
  });

  app.post('/api/tasks/:id/comments', (req: Request<IdParams>, res: Response) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const body = req.body as {
      path?: string;
      cwd?: string;
      newLine?: number;
      oldLine?: number;
      side?: 'add' | 'del' | 'ctx' | 'file';
      snippet?: string;
      body?: string;
    };
    if (!body.path?.trim() || !body.body?.trim()) {
      return res.status(400).json({ error: 'path and body are required' });
    }
    const side = body.side === 'del' || body.side === 'ctx' || body.side === 'file' ? body.side : 'add';
    const updated = taskStore.addChangelogComment(req.params.id, {
      path: body.path,
      // Which folder the file is in — a task can be working in several.
      cwd: typeof body.cwd === 'string' ? body.cwd : undefined,
      newLine: typeof body.newLine === 'number' ? body.newLine : undefined,
      oldLine: typeof body.oldLine === 'number' ? body.oldLine : undefined,
      side,
      snippet: typeof body.snippet === 'string' ? body.snippet : undefined,
      body: body.body
    });
    respondWithTask(publisher, res, updated, 'Could not add that comment');
  });

  /**
   * Batch endpoint behind `respond_to_changelog_comments`: every reply and
   * resolution the agent produced in a turn lands in one write and one broadcast.
   */
  app.post('/api/tasks/:id/comments/respond', (req: Request<IdParams>, res: Response) => {
    if (!taskStore.getTask(req.params.id)) return res.status(404).json({ error: 'Task not found' });
    const payload = req.body as { responses?: unknown; author?: ChangelogAuthor };
    const responses = normalizeChangelogResponses(payload?.responses);
    if (responses.length === 0) {
      return res.status(400).json({ error: 'responses must list entries with a commentId and a reply or status' });
    }
    const outcome = taskStore.applyChangelogResponses(req.params.id, responses, parseAuthor(payload?.author));
    if (!outcome) return res.status(404).json({ error: 'Task not found' });
    const live = outcome.result.applied.length > 0
      ? publisher.updated(outcome.task)
      : publisher.present(outcome.task);
    res.json({ ...outcome.result, comments: live.changelogComments || [] });
  });

  app.post('/api/tasks/:id/comments/:commentId/replies', (req: Request<CommentParams>, res: Response) => {
    if (!taskStore.getTask(req.params.id)) return res.status(404).json({ error: 'Task not found' });
    const { body, author } = req.body as { body?: string; author?: ChangelogAuthor };
    if (!body?.trim()) return res.status(400).json({ error: 'body is required' });
    const updated = taskStore.replyToChangelogComment(req.params.id, req.params.commentId, body, parseAuthor(author));
    respondWithTask(publisher, res, updated);
  });

  app.post('/api/tasks/:id/comments/:commentId/resolve', (req: Request<CommentParams>, res: Response) => {
    if (!taskStore.getTask(req.params.id)) return res.status(404).json({ error: 'Task not found' });
    const resolved = (req.body as { resolved?: boolean }).resolved !== false;
    const updated = taskStore.resolveChangelogComment(req.params.id, req.params.commentId, resolved);
    respondWithTask(publisher, res, updated);
  });

  app.delete('/api/tasks/:id/comments/:commentId', (req: Request<CommentParams>, res: Response) => {
    if (!taskStore.getTask(req.params.id)) return res.status(404).json({ error: 'Task not found' });
    const updated = taskStore.deleteChangelogComment(req.params.id, req.params.commentId);
    respondWithTask(publisher, res, updated);
  });
}
