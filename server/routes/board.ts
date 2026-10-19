import { Express, Request, Response } from 'express';
import { AcpConfigOptionsResult, ConfigFreshness, acpManager } from '../acp/client.js';
import { findAgentName, pickDefaultAgent } from '../../shared/agent/agents.js';
import { liveTasks } from '../../shared/task/archive.js';
import { BoardTask } from '../../shared/types.js';
import { route } from '../http/app.js';
import { stripLogs } from '../live/hub.js';
import { hydrateTasks, withLiveStatus } from '../opencode/hydrate.js';
import { readOffThread } from '../opencode/readerThread.js';
import { taskStore } from '../board/taskStore.js';
import { modelProbeFolders } from '../setup/configLayers.js';
import { clearOpencodeSnapshots } from '../toolCatalog/index.js';
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
  if (freshness === 'restarted') clearOpencodeSnapshots();
  const fetched = await acpManager.fetchConfigOptions(modelId, modelProbeFolders());
  const config = { ...fetched, models: withModelScopes(fetched.models, taskStore.getSettings().projects) };
  return freshness === 'stale' ? { ...config, configStale: true } : config;
}

/**
 * How long the board's first paint waits on OpenCode. Its database runs to
 * tens of gigabytes and a cold read of it can take minutes; `session/new` can
 * stall on a folder's MCP servers. Neither is worth a blank screen: past this,
 * the board goes out as the store has it and the rest follows over the socket.
 */
const BOARD_WAIT_MS = 1500;

/** `promise`'s value if it settles within `ms`, else undefined; it keeps running either way. */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The DB pass a board load is waiting on, shared by every load that arrives
 * while it runs. A late pass makes the client load again; without this each of
 * those loads would queue another full pass behind it on the reader thread.
 */
let hydrating: Promise<BoardTask[]> | null = null;

function hydrateBoard(sync: RouteContext['sync']): Promise<BoardTask[]> {
  hydrating ??= (async () => {
    await sync.syncRunStates();
    const latest = taskStore.getBoardState();
    // Archived tasks are not in this response. Statusing their worktrees on
    // every load is a git process per leftover checkout.
    const tasks = await hydrateTasks(liveTasks(latest.tasks), latest.settings.projects);
    sync.persistAdoptedTitles(tasks);
    return tasks;
  })().finally(() => {
    hydrating = null;
  });
  return hydrating;
}

/** The lists the last board load got, sent again when this one's are late. */
let lastConfig: Awaited<ReturnType<typeof readConfig>> | undefined;

/** The whole board in one response, plus the settings writes that shape it. */
export function registerBoardRoutes(app: Express, { sync, orchestrator, publisher }: RouteContext): void {
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
    const spendPromise = readOffThread('boardSpend', state.settings.projects, Date.now(), calendar.locale, calendar.timeZone);

    // Run states, then each session's cost and context, read off OpenCode's DB.
    const hydrated = hydrateBoard(sync);

    const [ready, freshConfig, spend] = await Promise.all([
      within(hydrated, BOARD_WAIT_MS),
      within(configPromise, BOARD_WAIT_MS),
      // The header's figure is optional: without it the client reads it itself.
      within(spendPromise.catch(() => undefined), BOARD_WAIT_MS)
    ]);
    if (freshConfig) lastConfig = freshConfig;
    const config = freshConfig ?? lastConfig;
    // Late answers still land: cost and status as a push per task, the lists
    // as the same "read them again" a changed config sends.
    if (!ready) {
      void hydrated.then(
        (tasks) => tasks.forEach((task) => publisher.refresh(task.id)),
        (e) => console.warn('[Board] Late OpenCode read failed:', errorMessage(e))
      );
    }
    if (!freshConfig) {
      void configPromise.then(
        () => publisher.configUpdated(),
        (e) => console.warn('[Board] Late config read failed:', errorMessage(e))
      );
    }

    const settingsPatch: Partial<typeof state.settings> = {};
    // Never copy the scratch ACP session's current model/agent onto the board —
    // that is OpenCode's last-used mode for this repo, not the user's default.
    // Matched ignoring case, and rewritten to OpenCode's spelling: 2.x calls a
    // 1.x "CEO" agent "ceo", and that is not a reason to fall back to another.
    const listedDefault = config && findAgentName(config.agents.map(a => a.name), state.settings.defaultAgent);
    if (config && config.agents.length > 0 && (!listedDefault || listedDefault !== state.settings.defaultAgent)) {
      settingsPatch.defaultAgent = pickDefaultAgent(config.agents, state.settings.defaultAgent);
    }
    if (Object.keys(settingsPatch).length) taskStore.updateSettings(settingsPatch);

    const board = taskStore.getBoardState();
    res.json({
      ...board,
      // Archived tasks never reach the board: the kanban and every count it
      // takes are the live list. The archive panel fetches its own.
      tasks: liveTasks(board.tasks).map((task) => stripLogs(withLiveStatus(task))),
      models: config?.models ?? [],
      agents: config?.agents ?? [],
      effortLevels: config?.effortLevels ?? [],
      configStale: config?.configStale,
      spend
    });
  }));

  app.post('/api/settings', (req: Request, res: Response) => {
    res.json(taskStore.updateSettings(req.body));
  });
}
