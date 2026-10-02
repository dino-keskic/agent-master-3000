import { Express, Request, Response } from 'express';
import { AcpConfigOptionsResult, ConfigFreshness, acpManager } from '../acp/client.js';
import { pickDefaultAgent } from '../../shared/agent/agents.js';
import { liveTasks } from '../../shared/task/archive.js';
import { route } from '../http/app.js';
import { stripLogs } from '../live/hub.js';
import { hydrateTasks, withLiveStatus } from '../opencode/hydrate.js';
import { boardSpend } from '../opencode/spend.js';
import { taskStore } from '../board/taskStore.js';
import { modelProbeFolders } from '../setup/configLayers.js';
import { clearToolCatalogCache } from '../toolCatalog/index.js';
import { TurnOrchestrator } from '../turns/orchestrator.js';
import { RouteContext } from './context.js';
import { requestCalendar } from './common.js';
import { errorMessage } from '../../shared/errors.js';
import { withModelScopes } from '../../shared/agent/modelScope.js';

/**
 * OpenCode's model, agent and effort lists as every board project sees them,
 * read after the agent has caught up with any config file edited since it
 * started. `configStale` says it could not: work is running, and a restart
 * would cut it off.
 */
async function readConfig(
  orchestrator: TurnOrchestrator,
  modelId?: string
): Promise<AcpConfigOptionsResult & { configStale?: true }> {
  const freshness: ConfigFreshness = await acpManager.refreshConfig(() => orchestrator.busyTasks().length > 0);
  // The tool catalog is read from a separate `opencode serve`, which has the same stale config.
  if (freshness === 'restarted') clearToolCatalogCache();
  const fetched = await acpManager.fetchConfigOptions(modelId, modelProbeFolders());
  const config = { ...fetched, models: withModelScopes(fetched.models, taskStore.getSettings().projects) };
  return freshness === 'stale' ? { ...config, configStale: true } : config;
}

/** The whole board in one response, plus the settings writes that shape it. */
export function registerBoardRoutes(app: Express, { sync, orchestrator }: RouteContext): void {
  app.get('/api/config-options', route(async (req: Request, res: Response) => {
    try {
      const modelId = req.query.model as string | undefined;
      res.json(await readConfig(orchestrator, modelId));
    } catch (e) {
      res.status(500).json({ error: errorMessage(e) ?? String(e) });
    }
  }));

  app.get('/api/board', route(async (req: Request, res: Response) => {
    const state = taskStore.getBoardState();
    // Config is an ACP round-trip; overlap it with the OpenCode DB hydrate so
    // cost/context are not stuck behind session/new. Spend is the same class of
    // read — run it here so the header has this week's figure on first paint.
    const configPromise = readConfig(orchestrator, state.settings.defaultModel);
    const calendar = requestCalendar(req);
    const spendPromise = Promise.resolve().then(() =>
      boardSpend(state.settings.projects, Date.now(), calendar.locale, calendar.timeZone)
    );

    await sync.syncRunStates();
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
      configStale: config.configStale,
      spend
    });
  }));

  app.post('/api/settings', (req: Request, res: Response) => {
    res.json(taskStore.updateSettings(req.body));
  });
}
