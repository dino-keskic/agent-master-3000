import { Express, Request, Response } from 'express';
import { deriveTaskTitle } from '../../shared/format.js';
import { listTaskSessions, sessionChoiceOf, sessionCwd } from '../../shared/task/sessions.js';
import { SubagentSession } from '../../shared/sessions/types.js';
import { BoardTask } from '../../shared/types.js';
import { acpManager } from '../acp/client.js';
import { IdParams, SessionParams, route } from '../http/app.js';
import { cloneOpenCodeSession } from '../opencode/clone.js';
import { loadSessionHistory } from '../opencode/history.js';
import { listChildSessions } from '../opencode/subagents.js';
import { activeSessionIds } from '../opencode/liveTurns.js';
import { markRunningSubagents } from '../../shared/sessions/subagents.js';
import { resolveImages } from '../board/attachments.js';
import { taskStore } from '../board/taskStore.js';
import { RouteContext } from './context.js';
import { errorMessage } from '../../shared/errors.js';

interface StartSessionBody {
  mode?: 'fork' | 'new';
  prompt?: string;
  /** Images dropped into the box the session is started from. */
  images?: unknown;
  title?: string;
  model?: string;
  agent?: string;
  thinkingLevel?: string;
  sourceSessionId?: string;
  cwd?: string;
  projectId?: string;
}

/**
 * What the start form picked, kept as this one session's setting.
 *
 * Deliberately not written onto the task: the task's settings configure every
 * session it owns, on every turn, so a fork asked on a different model used to
 * quietly re-model the main conversation too.
 */
function pickedFor(task: BoardTask, body: StartSessionBody) {
  return sessionChoiceOf(task, {
    model: body.model,
    agent: body.agent,
    thinkingLevel: body.thinkingLevel
  });
}

/**
 * Start another session on a task.
 *
 * `fork` copies an existing session — messages and all — so the new one starts
 * knowing everything the old one knew, and the original is left untouched. This
 * is what "BTW" does: ask a side question without polluting the main thread.
 *
 * `new` starts blank, for continuing the work with a clean context.
 *
 * Both run concurrently with whatever else the task has going.
 */
function startSessionRoute({ publisher, orchestrator }: RouteContext) {
  return async (req: Request<IdParams>, res: Response) => {
    const { id } = req.params;
    const body = req.body as StartSessionBody;

    const task = taskStore.getTask(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const isFork = body.mode !== 'new';
    const prompt = body.prompt?.trim();
    const images = resolveImages(body.images);
    if (isFork && !prompt && images.length === 0) {
      return res.status(400).json({ error: 'A fork needs a prompt — it is the question you are asking the copy' });
    }

    const chosen = pickedFor(task, body);
    const title =
      body.title?.trim() || (prompt ? deriveTaskTitle(prompt) : '') || (isFork ? 'Side Chat' : 'New session');

    if (!isFork) {
      // A blank session becomes the task's primary one: the user asked to carry
      // the work on somewhere fresh, not to open a side conversation. With no
      // prompt it opens empty and waits for one: without `openOnly` the turn
      // would fall back to the task's own prompt and redo the work.
      void orchestrator.start(id, prompt, {
        newSession: true,
        openOnly: !prompt && images.length === 0,
        primary: true,
        title,
        chosen,
        images,
        reconfigure: true,
        cwd: body.cwd?.trim() || undefined,
        projectId: body.projectId?.trim() || undefined
      });
      return res.json(publisher.present(taskStore.getTask(id) || task));
    }

    const baseSessionId = body.sourceSessionId || task.activeSessionId || task.sessionId;
    if (!baseSessionId) {
      return res.status(400).json({ error: 'There is no session to fork yet — run this task first' });
    }

    const cloned = cloneOpenCodeSession(baseSessionId, title);
    if (!cloned) {
      return res.status(502).json({ error: 'Could not copy that session in the OpenCode database' });
    }

    void orchestrator.start(id, prompt, {
      sessionId: cloned.sessionId,
      isBtw: true,
      primary: false,
      forkedFrom: baseSessionId,
      costAtFork: cloned.costAtFork,
      title,
      chosen,
      images,
      reconfigure: true
    });

    res.json(publisher.present(taskStore.getTask(id) || task));
  };
}

/** The sessions linked to one task: starting them, reading them, steering them. */
export function registerSessionRoutes(app: Express, ctx: RouteContext): void {
  const { publisher, orchestrator } = ctx;
  const startSession = startSessionRoute(ctx);

  app.post('/api/tasks/:id/sessions', route(startSession));

  /** @deprecated Forks now go through POST /sessions with mode 'fork'. */
  app.post('/api/tasks/:id/btw', route(async (req: Request<IdParams>, res: Response) => {
    req.body = { ...req.body, mode: 'fork' };
    return startSession(req, res);
  }));

  /** Switch currently viewed/active session for a task in the drawer. */
  app.post('/api/tasks/:id/sessions/switch', (req: Request<IdParams>, res: Response) => {
    const { sessionId } = req.body as { sessionId?: string };
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    const updated = taskStore.switchActiveSession(req.params.id, sessionId);
    if (!updated) return res.status(404).json({ error: 'Task not found' });
    res.json(publisher.updated(updated));
  });

  /** Retrieve transcript logs and details for a specific linked session. */
  app.get('/api/tasks/:id/sessions/:sessionId/history', route(async (req: Request<SessionParams>, res: Response) => {
    const { id, sessionId } = req.params;
    if (!taskStore.getTask(id)) return res.status(404).json({ error: 'Task not found' });

    const history = loadSessionHistory(sessionId);
    res.json({
      sessionId,
      logs: history.logs,
      model: history.model,
      agent: history.agent
    });
  }));

  /** Child OpenCode sessions (subagents) of every linked session on this task. */
  app.get('/api/tasks/:id/subagents', (req: Request<IdParams>, res: Response) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const links = listTaskSessions(task);
    // One probe for the whole task: the liveness walk is a recursive query per
    // call, and every linked session's tree hangs off the same few roots.
    const live = activeSessionIds(links.map((link) => link.sessionId));

    const result: Record<string, SubagentSession[]> = {};
    for (const link of links) {
      result[link.sessionId] = markRunningSubagents(listChildSessions(link.sessionId), live);
    }
    res.json(result);
  });

  /** Send a follow-up prompt to a specific linked session. */
  app.post('/api/tasks/:id/sessions/:sessionId/prompt', route(async (req: Request<SessionParams>, res: Response) => {
    const { id, sessionId } = req.params;
    const { prompt, images } = req.body as { prompt?: string; images?: unknown };
    const attached = resolveImages(images);
    if (!prompt?.trim() && attached.length === 0) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const task = taskStore.getTask(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    taskStore.switchActiveSession(id, sessionId);
    // `primary` is pinned to what the session already is: replying in a fork must
    // not quietly redirect the task's follow-ups and column runs into it.
    void orchestrator.start(id, prompt?.trim() || '', {
      sessionId,
      primary: sessionId === task.sessionId,
      images: attached
    });
    res.json(publisher.present(taskStore.getTask(id) || task));
  }));

  /**
   * What one session runs as. The composer writes here rather than onto the
   * task, so changing the model while a fork is on screen leaves the task's
   * main conversation — and its other forks — running as they were.
   */
  app.post('/api/tasks/:id/sessions/:sessionId/settings', (req: Request<SessionParams>, res: Response) => {
    const { model, agent, thinkingLevel } = req.body as StartSessionBody;
    const updated = taskStore.setSessionChoice(req.params.id, req.params.sessionId, {
      model,
      agent,
      thinkingLevel
    });
    if (!updated) return res.status(404).json({ error: 'Task not found' });
    res.json(publisher.updated(updated));
  });

  /** Stop the turn in one session, leaving the task's other sessions running. */
  app.post('/api/tasks/:id/sessions/:sessionId/stop', route(async (req: Request<SessionParams>, res: Response) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(await orchestrator.stopSession(task, req.params.sessionId));
  }));

  /**
   * Make a linked session the task's primary one — where plain follow-ups and a
   * column's auto-run go. Promoting a fork is how a side chat that turned out to
   * be the real work becomes the main thread.
   */
  app.post('/api/tasks/:id/sessions/:sessionId/promote', route(async (req: Request<SessionParams>, res: Response) => {
    const { id, sessionId } = req.params;
    const task = taskStore.getTask(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!listTaskSessions(task).some((link) => link.sessionId === sessionId)) {
      return res.status(404).json({ error: 'That session is not linked to this task' });
    }
    const promoted = taskStore.setPrimarySession(id, sessionId, { archivePrevious: false });
    if (!promoted) return res.status(404).json({ error: 'Task not found' });
    // Bind it in the manager too, so a stop or a plain prompt lands in it.
    const promotedLink = listTaskSessions(promoted).find((link) => link.sessionId === sessionId);
    await acpManager
      .importSession(id, sessionId, sessionCwd(promoted, promotedLink) || process.cwd(), { replayLogs: false, primary: true })
      .catch((e: unknown) => console.warn(`[Server] Could not bind promoted session ${sessionId}:`, errorMessage(e) ?? e));

    res.json(publisher.updated(taskStore.getTask(id) || promoted));
  }));

  /** Summarize one session so it can keep going with a smaller context. */
  app.post('/api/tasks/:id/sessions/:sessionId/compact', route(async (req: Request<SessionParams>, res: Response) => {
    const { id, sessionId } = req.params;
    const task = taskStore.getTask(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (orchestrator.isTurnBusy(id, sessionId)) {
      return res.status(409).json({ error: 'A turn is already running in this session — stop it before compacting' });
    }

    void orchestrator.compact(id, sessionId).catch((e: unknown) => {
      console.error(`[Server] Compact failed for ${id}/${sessionId}:`, e);
    });
    res.json(publisher.present(taskStore.getTask(id) || task));
  }));
}
