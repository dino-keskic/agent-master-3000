import { Express, Request, Response } from 'express';
import { errorMessage } from '../../shared/errors.js';
import { SkillInventory } from '../../shared/skills/skills.js';
import { listTaskSessions, sessionCwd } from '../../shared/task/sessions.js';
import { acpManager } from '../acp/client.js';
import { taskStore } from '../board/taskStore.js';
import { IdParams, route } from '../http/app.js';
import { clearCommandsCache } from '../opencode/commands.js';
import {
  defaultSkillWriteDir,
  deleteSkill,
  deleteSkillAuxFile,
  listSkills,
  readSkillAuxFile,
  saveSkill,
  saveSkillAuxFile
} from '../opencode/skills.js';
import { clearOpencodeSnapshots } from '../toolCatalog/index.js';
import { queryString } from './common.js';
import { RouteContext } from './context.js';

/** Skill discovery, editing (`SKILL.md` + bundled files), and live policy for task and workspace views. */
export function registerSkillRoutes(app: Express, { orchestrator, publisher }: RouteContext): void {
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

  const buildInventory = (cwd: string): SkillInventory => {
    const skillPolicy = taskStore.getSettings().skillPolicy || {};
    return {
      cwd,
      skills: listSkills(cwd).map((skill) => ({
        ...skill,
        disabled: skillPolicy[skill.name] === false
      })),
      projectDir: defaultSkillWriteDir(cwd, 'project'),
      globalDir: defaultSkillWriteDir(cwd, 'global'),
      skillPolicy,
      pendingRestart: acpManager.toolPolicyPending()
    };
  };

  const applySkillChange = async (): Promise<boolean> => {
    clearCommandsCache();
    clearOpencodeSnapshots();
    const liveApplied = acpManager.applyToolPolicy(true);
    if (liveApplied) {
      publisher.configUpdated();
      return false;
    }
    if (orchestrator.busyTasks().length === 0) {
      await acpManager.restartAgent();
      publisher.configUpdated();
      return false;
    }
    return true;
  };

  const handleList = (cwd: string, res: Response) => {
    res.json(buildInventory(cwd));
  };

  const handleSave = async (cwd: string, req: Request, res: Response) => {
    try {
      const skill = saveSkill(cwd, req.body);
      const pendingRestart = await applySkillChange();
      const inventory = buildInventory(cwd);
      const skillPolicy = taskStore.getSettings().skillPolicy || {};
      res.json({
        skill: { ...skill, disabled: skillPolicy[skill.name] === false },
        inventory: { ...inventory, pendingRestart },
        pendingRestart
      });
    } catch (e) {
      res.status(400).json({ error: errorMessage(e) || 'Could not save skill' });
    }
  };

  const handleDelete = async (cwd: string, req: Request, res: Response) => {
    const dirPath = typeof req.body?.dirPath === 'string' ? req.body.dirPath : '';
    if (!dirPath) return res.status(400).json({ error: 'dirPath is required' });
    try {
      deleteSkill(cwd, dirPath);
      const pendingRestart = await applySkillChange();
      const inventory = buildInventory(cwd);
      res.json({ inventory: { ...inventory, pendingRestart }, pendingRestart });
    } catch (e) {
      res.status(400).json({ error: errorMessage(e) || 'Could not delete skill' });
    }
  };

  const handleReadFile = (cwd: string, req: Request, res: Response) => {
    const dirPath = queryString(req, 'dir');
    const relativePath = queryString(req, 'path');
    if (!dirPath || !relativePath) return res.status(400).json({ error: 'dir and path are required' });
    try {
      res.json(readSkillAuxFile(cwd, dirPath, relativePath));
    } catch (e) {
      res.status(400).json({ error: errorMessage(e) || 'Could not read skill file' });
    }
  };

  const handleSaveFile = async (cwd: string, req: Request, res: Response) => {
    const dirPath = typeof req.body?.dirPath === 'string' ? req.body.dirPath : '';
    const relativePath = typeof req.body?.relativePath === 'string' ? req.body.relativePath : '';
    const content = typeof req.body?.content === 'string' ? req.body.content : '';
    if (!dirPath || !relativePath) return res.status(400).json({ error: 'dirPath and relativePath are required' });
    try {
      const files = saveSkillAuxFile(cwd, dirPath, relativePath, content);
      const pendingRestart = await applySkillChange();
      const inventory = buildInventory(cwd);
      res.json({ files, inventory: { ...inventory, pendingRestart }, pendingRestart });
    } catch (e) {
      res.status(400).json({ error: errorMessage(e) || 'Could not save skill file' });
    }
  };

  const handleDeleteFile = async (cwd: string, req: Request, res: Response) => {
    const dirPath = typeof req.body?.dirPath === 'string' ? req.body.dirPath : '';
    const relativePath = typeof req.body?.relativePath === 'string' ? req.body.relativePath : '';
    if (!dirPath || !relativePath) return res.status(400).json({ error: 'dirPath and relativePath are required' });
    try {
      const files = deleteSkillAuxFile(cwd, dirPath, relativePath);
      const pendingRestart = await applySkillChange();
      const inventory = buildInventory(cwd);
      res.json({ files, inventory: { ...inventory, pendingRestart }, pendingRestart });
    } catch (e) {
      res.status(400).json({ error: errorMessage(e) || 'Could not delete skill file' });
    }
  };

  app.post('/api/skills/policy', route(async (req: Request, res: Response) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) return res.status(400).json({ error: 'A skill name is required' });
    const enabled = req.body?.enabled;
    if (enabled !== null && typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be true, false, or null' });
    }

    const skillPolicy = { ...(taskStore.getSettings().skillPolicy || {}) };
    if (enabled === false) skillPolicy[name] = false;
    else delete skillPolicy[name];

    const settings = taskStore.updateSettings({ skillPolicy });
    const pendingRestart = await applySkillChange();
    res.json({ skillPolicy: settings.skillPolicy || {}, pendingRestart });
  }));

  app.get('/api/tasks/:id/skills', (req: Request<IdParams>, res: Response) => {
    const cwd = resolveTaskCwd(req);
    if (!cwd) return res.status(404).json({ error: 'Task not found' });
    handleList(cwd, res);
  });

  app.post('/api/tasks/:id/skills', route(async (req: Request<IdParams>, res: Response) => {
    const cwd = resolveTaskCwd(req);
    if (!cwd) return res.status(404).json({ error: 'Task not found' });
    await handleSave(cwd, req, res);
  }));

  app.delete('/api/tasks/:id/skills', route(async (req: Request<IdParams>, res: Response) => {
    const cwd = resolveTaskCwd(req);
    if (!cwd) return res.status(404).json({ error: 'Task not found' });
    await handleDelete(cwd, req, res);
  }));

  app.get('/api/tasks/:id/skills/file', (req: Request<IdParams>, res: Response) => {
    const cwd = resolveTaskCwd(req);
    if (!cwd) return res.status(404).json({ error: 'Task not found' });
    handleReadFile(cwd, req, res);
  });

  app.put('/api/tasks/:id/skills/file', route(async (req: Request<IdParams>, res: Response) => {
    const cwd = resolveTaskCwd(req);
    if (!cwd) return res.status(404).json({ error: 'Task not found' });
    await handleSaveFile(cwd, req, res);
  }));

  app.delete('/api/tasks/:id/skills/file', route(async (req: Request<IdParams>, res: Response) => {
    const cwd = resolveTaskCwd(req);
    if (!cwd) return res.status(404).json({ error: 'Task not found' });
    await handleDeleteFile(cwd, req, res);
  }));

  app.get('/api/workspace/skills', (req: Request, res: Response) => {
    handleList(resolveWorkspaceCwd(req), res);
  });

  app.post('/api/workspace/skills', route(async (req: Request, res: Response) => {
    await handleSave(resolveWorkspaceCwd(req), req, res);
  }));

  app.delete('/api/workspace/skills', route(async (req: Request, res: Response) => {
    await handleDelete(resolveWorkspaceCwd(req), req, res);
  }));

  app.get('/api/workspace/skills/file', (req: Request, res: Response) => {
    handleReadFile(resolveWorkspaceCwd(req), req, res);
  });

  app.put('/api/workspace/skills/file', route(async (req: Request, res: Response) => {
    await handleSaveFile(resolveWorkspaceCwd(req), req, res);
  }));

  app.delete('/api/workspace/skills/file', route(async (req: Request, res: Response) => {
    await handleDeleteFile(resolveWorkspaceCwd(req), req, res);
  }));
}
