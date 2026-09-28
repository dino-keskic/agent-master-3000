import { OpenCodeSync } from '../opencode/sync.js';
import { BoardPublisher } from '../live/publisher.js';
import { TurnOrchestrator } from '../turns/orchestrator.js';
import { TurnRegistry } from '../turns/registry.js';

/**
 * What a route group is allowed to reach for.
 *
 * Stores and the ACP manager are module singletons and imported directly, the
 * way the rest of the server does it. These four are not: they hold the live
 * process state, so a route that wants one has to be handed it — which is also
 * what keeps the wiring in `index.ts` honest about who depends on what.
 */
export interface RouteContext {
  publisher: BoardPublisher;
  orchestrator: TurnOrchestrator;
  turns: TurnRegistry;
  sync: OpenCodeSync;
}
