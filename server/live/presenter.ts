import { BoardTask, QueuedTurn } from '../../shared/types.js';
import { withLiveStatus } from '../opencode/hydrate.js';
import { TurnRegistry } from '../turns/registry.js';

/**
 * The task as a client should see it: the live cwd/session overlay, plus the
 * prompts still waiting to run.
 *
 * The queue lives in this process and is never written to the board file, so it
 * is attached on the way out. That keeps it exactly as true as the process that
 * owns it, with nothing to migrate and nothing to go stale on disk.
 */
export class Presenter {
  constructor(private readonly turns: TurnRegistry) {}

  present(task: BoardTask): BoardTask {
    return this.withQueued(withLiveStatus(task));
  }

  private withQueued(task: BoardTask): BoardTask {
    const queued = this.turns.queuedForTask(task.id);
    if (queued.length === 0) return task;

    const bySession = new Map<string, QueuedTurn[]>();
    for (const turn of queued) {
      if (!turn.sessionId) continue;
      const forSession = bySession.get(turn.sessionId);
      if (forSession) forSession.push(turn);
      else bySession.set(turn.sessionId, [turn]);
    }

    return {
      ...task,
      queued,
      sessions: task.sessions?.map((link) => {
        const forSession = bySession.get(link.sessionId);
        return forSession ? { ...link, queued: forSession } : link;
      })
    };
  }
}
