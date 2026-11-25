import { Express, Request, Response } from 'express';
import { AgentInventory, setAgentToolRule } from '../../shared/agent/customAgents.js';
import { errorMessage } from '../../shared/errors.js';
import { listTaskSessions, sessionCwd } from '../../shared/task/sessions.js';
import { acpManager } from '../acp/client.js';
import { taskStore } from '../board/taskStore.js';
import { IdParams, route } from '../http/app.js';
import {
  defaultAgentWriteDir,
  deleteCustomAgent,
  listCustomAgents,
  saveCustomAgent,
  toggleCustomAgentTool
} from '../opencode/customAgents.js';
import { clearOpencodeSnapshots } from '../toolCatalog/index.js';
import { RouteContext } from './context.js';

/** Custom agent discovery, editing, and per-agent tool overrides for task and workspace views. */
export function registerAgentRoutes(app: Express, { orchestrator, publisher }: RouteContext): void {
  const resolveTaskCwd = (req: Request<IdParams>): string | null => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return null;
    const sessionId = typeof req.query.session === 'string' ? req.query.session : undefined;
    const link = sessionId ? listTaskSessions(task).find((item) => item.sessionId === sessionId) : undefined;
    return sessionCwd(task, link);
  };

  const resolveWorkspaceCwd = (req: Request): string => {
    const requested = typeof req.query.cwd === 'string' ? req.query.cwd.trim() : '';
    return requested || taskStore.getSettings().projects[0]?.path || process.cwd();
  };

  const buildInventory = async (cwd: string): Promise<AgentInventory> => {
    const config = await acpManager.fetchConfigOptions(undefined, [cwd]).catch(() => ({ agents: [] }));
    return {
      cwd,
      agents: listCustomAgents(cwd, { runtimeAgents: config.agents }),
      agentToolPolicy: taskStore.getSettings().agentToolPolicy || {},
      pendingRestart: acpManager.configPending() || acpManager.toolPolicyPending(),
      projectDir: defaultAgentWriteDir(cwd, 'project'),
      globalDir: defaultAgentWriteDir(cwd, 'global')
    };
  };

  const applyConfigChange = async (notifyBoard: boolean): Promise<boolean> => {
    clearOpencodeSnapshots();
    const liveApplied = acpManager.applyToolPolicy(true);
    if (liveApplied) {
      if (notifyBoard) publisher.configUpdated();
      return false;
    }
    if (orchestrator.busyTasks().length === 0) {
      await acpManager.restartAgent();
      if (notifyBoard) publisher.configUpdated();
      return false;
    }
    return true;
  };

  const handleList = async (cwd: string, res: Response) => {
    res.json(await buildInventory(cwd));
  };

  const handleSave = async (cwd: string, req: Request, res: Response) => {
    try {
      const agent = saveCustomAgent(cwd, req.body);
      const pendingRestart = await applyConfigChange(true);
      const inventory = await buildInventory(cwd);
      res.json({ agent, inventory: { ...inventory, pendingRestart }, pendingRestart });
    } catch (e) {
      res.status(400).json({ error: errorMessage(e) || 'Could not save agent' });
    }
  };

  const handleToggleTool = async (cwd: string, req: Request, res: Response) => {
    const rule = typeof req.body?.rule === 'string' ? req.body.rule.trim() : '';
    const agentId = typeof req.body?.agentId === 'string' ? req.body.agentId.trim() : '';
    const filePath = typeof req.body?.filePath === 'string' ? req.body.filePath.trim() : '';
    const enabled = req.body?.enabled;
    if (!rule || !agentId) return res.status(400).json({ error: 'agentId and rule are required' });
    if (enabled !== null && typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be true, false, or null' });
    }

    try {
      if (filePath) {
        const agent = toggleCustomAgentTool(cwd, filePath, rule, enabled);
        const existingPolicy = taskStore.getSettings().agentToolPolicy;
        if (existingPolicy?.[agentId]) {
          const next = { ...existingPolicy };
          delete next[agentId];
          taskStore.updateSettings({ agentToolPolicy: next });
        }
        const pendingRestart = await applyConfigChange(false);
        const inventory = await buildInventory(cwd);
        return res.json({ agent, inventory: { ...inventory, pendingRestart }, pendingRestart });
      }

      const currentPolicy = { ...(taskStore.getSettings().agentToolPolicy || {}) };
      const updatedForAgent = setAgentToolRule(currentPolicy[agentId], rule, enabled);
      if (Object.keys(updatedForAgent).length > 0) currentPolicy[agentId] = updatedForAgent;
      else delete currentPolicy[agentId];

      taskStore.updateSettings({ agentToolPolicy: currentPolicy });
      acpManager.applyToolPolicy();
      const pendingRestart = acpManager.toolPolicyPending() || acpManager.configPending();
      const inventory = await buildInventory(cwd);
      return res.json({ inventory: { ...inventory, pendingRestart }, pendingRestart });
    } catch (e) {
      return res.status(400).json({ error: errorMessage(e) || 'Could not update agent tool' });
    }
  };

  const handleDelete = async (cwd: string, req: Request, res: Response) => {
    const filePath = typeof req.body?.filePath === 'string' ? req.body.filePath : '';
    if (!filePath) return res.status(400).json({ error: 'filePath is required' });
    try {
      deleteCustomAgent(cwd, filePath);
      const pendingRestart = await applyConfigChange(true);
      const inventory = await buildInventory(cwd);
      res.json({ inventory: { ...inventory, pendingRestart }, pendingRestart });
    } catch (e) {
      res.status(400).json({ error: errorMessage(e) || 'Could not delete agent' });
    }
  };

  app.get('/api/tasks/:id/agents', route(async (req: Request<IdParams>, res: Response) => {
    const cwd = resolveTaskCwd(req);
    if (!cwd) return res.status(404).json({ error: 'Task not found' });
    await handleList(cwd, res);
  }));

  app.post('/api/tasks/:id/agents', route(async (req: Request<IdParams>, res: Response) => {
    const cwd = resolveTaskCwd(req);
    if (!cwd) return res.status(404).json({ error: 'Task not found' });
    await handleSave(cwd, req, res);
  }));

  app.post('/api/tasks/:id/agents/tool', route(async (req: Request<IdParams>, res: Response) => {
    const cwd = resolveTaskCwd(req);
    if (!cwd) return res.status(404).json({ error: 'Task not found' });
    await handleToggleTool(cwd, req, res);
  }));

  app.delete('/api/tasks/:id/agents', route(async (req: Request<IdParams>, res: Response) => {
    const cwd = resolveTaskCwd(req);
    if (!cwd) return res.status(404).json({ error: 'Task not found' });
    await handleDelete(cwd, req, res);
  }));

  app.get('/api/workspace/agents', route(async (req: Request, res: Response) => {
    await handleList(resolveWorkspaceCwd(req), res);
  }));

  app.post('/api/workspace/agents', route(async (req: Request, res: Response) => {
    await handleSave(resolveWorkspaceCwd(req), req, res);
  }));

  app.post('/api/workspace/agents/tool', route(async (req: Request, res: Response) => {
    await handleToggleTool(resolveWorkspaceCwd(req), req, res);
  }));

  app.delete('/api/workspace/agents', route(async (req: Request, res: Response) => {
    await handleDelete(resolveWorkspaceCwd(req), req, res);
  }));
}
