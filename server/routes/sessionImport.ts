import { Express, Request, Response } from 'express';
import { pickLiveSessions } from '../../shared/sessions/list.js';
import { AcpSessionSummary } from '../../shared/sessions/types.js';
import { acpManager } from '../acp/client.js';
import { claimedSessions } from '../board/queries.js';
import { route } from '../http/app.js';
import { loadSessionHistory } from '../opencode/history.js';
import { activeRootSessionIds } from '../opencode/liveTurns.js';
import { getOpenCodeSession, getSessionChangeSummary, listOpenCodeSessions } from '../opencode/sessionList.js';
import { taskStore } from '../board/taskStore.js';
import { queryString } from './common.js';
import { RouteContext } from './context.js';
import { errorMessage } from '../../shared/errors.js';

/**
 * ACP's own session list, for a folder OpenCode's database knows nothing about
 * yet. Titles that look generated are dropped the same way the DB list drops
 * them, so the two paths show the user the same thing.
 */
async function listViaAcp(cwd: string, query: string, includeUntitled: boolean) {
  const acpList = await acpManager.listSessions(cwd).catch(() => []);
  const sessions = acpList.filter((s) => {
    if (!includeUntitled && /^New session - /.test(s.title)) return false;
    if (/subagent/i.test(s.title)) return false;
    if (!query) return true;
    const needle = query.toLowerCase();
    return s.title.toLowerCase().includes(needle) || s.cwd.toLowerCase().includes(needle);
  });
  return {
    sessions,
    total: sessions.length,
    untitledCount: acpList.filter((s) => /^New session - /.test(s.title)).length
  };
}

/** The OpenCode session behind an import, from the DB or from ACP. */
async function findSessionToImport(sessionId: string, scope?: string): Promise<AcpSessionSummary | undefined> {
  const fromDb = getOpenCodeSession(sessionId);
  if (fromDb) return fromDb;
  return (await acpManager.listSessions(scope)).find((s) => s.sessionId === sessionId);
}

/** Browsing OpenCode's existing sessions, and adopting one as a board task. */
export function registerSessionImportRoutes(app: Express, { publisher }: RouteContext): void {
  app.get('/api/acp/sessions', route(async (req: Request, res: Response) => {
    try {
      const query = queryString(req, 'q');
      const includeUntitled = req.query.untitled === '1';
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const claimed = claimedSessions();
      const projects = taskStore.getSettings().projects.map((p) => ({ name: p.name, path: p.path }));
      const cwdFilter = typeof req.query.cwd === 'string' ? req.query.cwd : undefined;

      let listed = await listOpenCodeSessions({
        projects: cwdFilter ? projects.filter((p) => p.path === cwdFilter) : projects,
        cwd: cwdFilter && projects.length === 0 ? cwdFilter : undefined,
        query,
        includeUntitled,
        includeRemoved: req.query.removed === '1',
        limit
      });

      if (listed.sessions.length === 0 && listed.total === 0 && cwdFilter) {
        listed = { ...listed, ...(await listViaAcp(cwdFilter, query, includeUntitled)) };
      }

      const tagged = listed.sessions.map((s) => ({ ...s, importedAsTaskId: claimed.get(s.sessionId) }));
      if (req.query.live === '1') {
        const live = pickLiveSessions(tagged);
        return res.json({ sessions: live, total: live.length, untitledCount: 0 });
      }

      res.json({ sessions: tagged, total: listed.total, untitledCount: listed.untitledCount });
    } catch (e) {
      res.status(502).json({ error: errorMessage(e) || 'Could not list OpenCode sessions' });
    }
  }));

  app.post('/api/tasks/from-session', route(async (req: Request, res: Response) => {
    const { sessionId, title, scopeCwd } = req.body as { sessionId?: string; title?: string; scopeCwd?: string };
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    const existing = taskStore.getTasks().find((t) => t.sessionId === sessionId);
    if (existing) {
      return res.status(409).json({ error: `Session already imported as ${existing.id}`, taskId: existing.id });
    }

    const lookupScope = scopeCwd || taskStore.getSettings().defaultCwd;
    let session: AcpSessionSummary | undefined;
    try {
      session = await findSessionToImport(sessionId, lookupScope);
    } catch (e) {
      return res.status(502).json({ error: errorMessage(e) || 'Could not reach OpenCode' });
    }
    if (!session) return res.status(404).json({ error: 'Session not found in OpenCode' });

    const resolvedTitle = (title || session.title || 'Imported session').trim();
    const resolvedCwd = session.cwd || lookupScope;
    const matchingProject = taskStore.getSettings().projects.find((p) => p.path === resolvedCwd);
    const history = loadSessionHistory(sessionId);
    const firstUser = history.logs.find((l) => l.type === 'user_say')?.text.trim();
    const lastUser = [...history.logs].reverse().find((l) => l.type === 'user_say')?.text;
    const lastAgent = [...history.logs].reverse().find((l) => l.type === 'agent_say')?.text;

    const task = taskStore.createTask({
      title: resolvedTitle,
      prompt: firstUser || resolvedTitle,
      description: firstUser || `Pinned OpenCode session ${sessionId}`,
      cwd: resolvedCwd,
      projectId: matchingProject?.id,
      sessionId,
      model: history.model,
      agent: history.agent || session.agent,
      changeSummary: getSessionChangeSummary(sessionId) || session.changeSummary,
      tokenCount: session.tokenCount,
      cost: session.cost,
      contextTokens: session.contextTokens,
      contextLimit: session.contextLimit,
      lastUserMessage: lastUser || resolvedTitle,
      lastMessage: lastAgent,
      logs: history.logs
    });

    // OpenCode may still be working in this session. Mark it running from the
    // DB *before* binding so live logs after import are accepted, then attach
    // ACP so stop/stream/permissions work the same as a board-started turn.
    if (activeRootSessionIds([sessionId]).has(sessionId)) {
      taskStore.setSessionRunState(task.id, sessionId, 'running');
    }
    void acpManager
      .importSession(task.id, sessionId, resolvedCwd, { replayLogs: false, primary: true })
      .catch((e: unknown) => {
        console.warn(`[Server] Could not bind imported session ${sessionId}:`, errorMessage(e) ?? e);
      });

    res.status(201).json(publisher.updated(taskStore.getTask(task.id) || task));
  }));
}
