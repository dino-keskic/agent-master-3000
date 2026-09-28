// First, before anything opens the state file: a board waiting to be copied
// into a new data folder has to be there when it does.
import './setup/dataMove.js';
import http from 'http';
import { WebSocketServer } from 'ws';
import { registerAcpEvents } from './turns/acpEvents.js';
import { CLIENT_DIR, IS_BUNDLED, listenAddress } from './app/appPaths.js';
import { setToolPolicySource } from './acp/transport.js';
import { BoardPoller } from './board/poller.js';
import { serveClient } from './http/clientStatic.js';
import { createApp, useErrorHandler } from './http/app.js';
import { kickLinkStatusRefresh, startLinkStatusRefresh } from './trackers/linkStatus.js';
import { LiveHub } from './live/hub.js';
import { OpenCodeSync } from './opencode/sync.js';
import { rememberProjects } from './opencode/hydrate.js';
import { Presenter } from './live/presenter.js';
import { BoardPublisher } from './live/publisher.js';
import { verifySocketClient, warnIfExposed } from './http/requestGuard.js';
import { registerRoutes } from './routes/index.js';
import { installShutdown } from './app/shutdown.js';
import { taskStore } from './board/taskStore.js';
import { TurnOrchestrator } from './turns/orchestrator.js';
import { TurnRegistry } from './turns/registry.js';

/**
 * The composition root.
 *
 * Nothing happens here except building the pieces and wiring them together, in
 * dependency order — registry, presenter, hub, publisher, orchestrator, sync,
 * poller. Each one only knows about the ones above it, so the graph reads top
 * to bottom and has nowhere for a cycle to hide.
 */

// The agent process is created lazily, and it reads the tool policy at spawn.
setToolPolicySource(() => taskStore.getSettings().toolPolicy || {});
// The overlay labels a task with the project its folder is in; without this it
// would have nothing to match against until the first poll comes back.
rememberProjects(taskStore.getSettings().projects);

const app = createApp();
const server = http.createServer(app);
// The UI never sends on the socket, so a small cap costs nothing and stops a
// client from making the server buffer ws's 100 MiB default.
const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: 64 * 1024,
  verifyClient: verifySocketClient
});

const turns = new TurnRegistry();
const presenter = new Presenter(turns);
const hub = new LiveHub(() => {
  poller.schedule(0);
  kickLinkStatusRefresh();
});
const publisher = new BoardPublisher(hub, presenter);
const orchestrator = new TurnOrchestrator(turns, publisher);
const sync = new OpenCodeSync(turns, publisher);
const poller = new BoardPoller(hub, sync);

hub.listen(wss);
installShutdown(server, wss);
registerAcpEvents(publisher, orchestrator);
registerRoutes(app, { publisher, orchestrator, turns, sync });
// The built app serves its own client; in dev that is Vite's job.
if (IS_BUNDLED && !serveClient(app, CLIENT_DIR)) {
  console.warn(`[Agent Master 3000] No built client in ${CLIENT_DIR} — serving the API only`);
}
useErrorHandler(app);

const { port: PORT, host: HOST } = listenAddress();
server.listen(PORT, HOST, () => {
  console.log(`[Agent Master 3000] Listening on http://${HOST}:${PORT}`);
  warnIfExposed();
  try {
    sync.syncRunStates();
  } catch (e) {
    console.warn('[Server] Initial session activity sync failed:', e);
  }
  poller.schedule();
  startLinkStatusRefresh(hub, publisher);
});
