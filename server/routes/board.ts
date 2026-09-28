import { Express, Request, Response } from 'express';
import { acpManager } from '../acp/client.js';
import { pickDefaultAgent } from '../../shared/agent/agents.js';
import { liveTasks } from '../../shared/task/archive.js';
import { route } from '../http/app.js';
import { stripLogs } from '../live/hub.js';
import { hydrateTasks, withLiveStatus } from '../opencode/hydrate.js';
import { boardSpend } from '../opencode/spend.js';
import { taskStore } from '../board/taskStore.js';
import { RouteContext } from './context.js';
import { requestCalendar } from './common.js';
import { errorMessage } from '../../shared/errors.js';

/** The whole board in one response, plus the settings writes that shape it. */
export function registerBoardRoutes(app: Express, { sync }: RouteContext): void {
  app.get('/api/config-options', route(async (req: Request, res: Response) => {
    try {
      const modelId = req.query.model as string | undefined;
      const config = await acpManager.fetchConfigOptions(modelId);
      res.json(config);
    } catch (e) {
      res.status(500).json({ error: errorMessage(e) ?? String(e) });
    }
  }));

  app.get('/api/board', route(async (req: Request, res: Response) => {
    const state = taskStore.getBoardState();
    // Config is an ACP round-trip; overlap it with the OpenCode DB hydrate so
    // cost/context are not stuck behind session/new. Spend is the same class of
    // read — run it here so the header has this week's figure on first paint.
    const configPromise = acpManager.fetchConfigOptions(state.settings.defaultModel);
    const calendar = requestCalendar(req);
    const spendPromise = Promise.resolve().then(() =>
      boardSpend(state.settings.projects, Date.now(), calendar.locale, calendar.timeZone)
    );

    sync.syncRunStates();
    const latest = taskStore.getBoardState();
    // Archived tasks are not in this response. Statusing their worktrees on
    // every load is a git process per leftover checkout.
    sync.persistAdoptedTitles(await hydrateTasks(liveTasks(latest.tasks), latest.settings.projects));

    const [config, spend] = await Promise.all([configPromise, spendPromise]);
    const settingsPatch: Partial<typeof state.settings> = {};
    // Never copy the scratch ACP session's current model/agent onto the board —
    // that is OpenCode's last-used mode for this repo, not the user's default.
    if (config.agents.length > 0 && !config.agents.some(a => a.name === state.settings.defaultAgent)) {
      settingsPatch.defaultAgent = pickDefaultAgent(config.agents, state.settings.defaultAgent);
    }
    if (Object.keys(settingsPatch).length) taskStore.updateSettings(settingsPatch);

    const board = taskStore.getBoardState();
    res.json({
      ...board,
      // Archived tasks never reach the board: the kanban and every count it
      // takes are the live list. The archive panel fetches its own.
      tasks: liveTasks(board.tasks).map((task) => stripLogs(withLiveStatus(task))),
      models: config.models,
      agents: config.agents,
      effortLevels: config.effortLevels,
      spend
    });
  }));

  app.post('/api/settings', (req: Request, res: Response) => {
    res.json(taskStore.updateSettings(req.body));
  });
}
