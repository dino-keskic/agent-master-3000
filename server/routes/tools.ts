import { Express, Request, Response } from 'express';
import { sessionTranscript } from '../../shared/task/logs.js';
import { listTaskSessions, sessionCwd } from '../../shared/task/sessions.js';
import { toolUsage } from '../../shared/agent/tools.js';
import { acpManager } from '../acp/client.js';
import { IdParams, route } from '../http/app.js';
import { taskStore } from '../board/taskStore.js';
import { clearToolCatalogCache, sessionToolInventory } from '../toolCatalog/index.js';
import { RouteContext } from './context.js';

/** The tool inventory, the policy that filters it, and the agent that serves it. */
export function registerToolRoutes(app: Express, { orchestrator }: RouteContext): void {
  /**
   * Everything the agent can call in this session: OpenCode's built-ins, each MCP
   * server's tools, and the changelog tools the board attaches itself — with what
   * the session actually used. Reading it starts a short-lived `opencode serve`,
   * so it is only ever fetched when the Tools tab is open.
   */
  app.get('/api/tasks/:id/tools', route(async (req: Request<IdParams>, res: Response) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const sessionId = typeof req.query.session === 'string' ? req.query.session : undefined;
    const links = listTaskSessions(task);
    const link = sessionId ? links.find((item) => item.sessionId === sessionId) : undefined;
    const logs = sessionTranscript(task.logs, sessionId, link?.logs, links);

    res.json(
      await sessionToolInventory({
        cwd: sessionCwd(task, link),
        agent: link?.agent || task.agent,
        usage: toolUsage(logs, sessionId),
        includeBoardTools: true,
        refresh: req.query.refresh === '1',
        policy: taskStore.getSettings().toolPolicy || {},
        pendingRestart: acpManager.toolPolicyPending()
      })
    );
  }));

  /**
   * Turn one tool off (or back on) for every session the board runs. `enabled:
   * null` drops the override and hands the decision back to the user's own
   * OpenCode config. An OpenCode 2 agent picks the change up on its next turn,
   * from the file it watches; 1.x needs the restart `pendingRestart` asks for.
   */
  app.post('/api/tools/policy', (req: Request, res: Response) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) return res.status(400).json({ error: 'A tool name is required' });

    const policy = { ...(taskStore.getSettings().toolPolicy || {}) };
    if (req.body.enabled === null) delete policy[name];
    else if (typeof req.body.enabled === 'boolean') policy[name] = req.body.enabled;
    else return res.status(400).json({ error: 'enabled must be true, false, or null' });

    const settings = taskStore.updateSettings({ toolPolicy: policy });
    acpManager.applyToolPolicy();
    clearToolCatalogCache();
    res.json({ policy: settings.toolPolicy || {}, pendingRestart: acpManager.toolPolicyPending() });
  });

  /**
   * Restart the agent process so it runs with the current tool policy. Refused
   * while work is in flight — restarting drops every running turn — unless the
   * caller insists.
   */
  app.post('/api/agent/restart', route(async (req: Request, res: Response) => {
    const busy = orchestrator.busyTasks();
    if (busy.length > 0 && req.body?.force !== true) {
      return res.status(409).json({
        error: `${busy.length} session${busy.length === 1 ? '' : 's'} still running`,
        busyTaskIds: busy.map((task) => task.id)
      });
    }

    await acpManager.restartAgent();
    clearToolCatalogCache();
    res.json({ restarted: true });
  }));
}
