import { isSessionBusy, listTaskSessions } from '../../shared/task/sessions.js';
import { SESSION_TITLE_SOON_MS, awaitsSessionTitle } from '../../shared/task/sessionTitles.js';
import { acpManager } from '../acp/client.js';
import { LiveHub } from '../live/hub.js';
import { OpenCodeSync } from '../opencode/sync.js';
import { taskStore } from './taskStore.js';

/**
 * The board's background poll.
 *
 * Every tick walks OpenCode's database, which is a WAL file that grows into
 * the tens of gigabytes, so the cadence is worth being careful about:
 *
 *   - With no browser attached there is nobody to push to, and the board
 *     re-reads everything on connect anyway (`GET /api/board`, then
 *     `GET /api/tasks/:id` per task opened). Polling into the void is pure
 *     waste, so we don't.
 *   - With nothing running, the only thing a tick can discover is a session
 *     that started outside the board. That is worth noticing, but not four
 *     times a minute times fifteen.
 *
 * Self-scheduling rather than `setInterval` so the next delay can be chosen
 * from what this tick actually found, and so a slow tick can never stack up
 * behind itself. The reads themselves run on the reader thread
 * (`server/opencode/readerThread.ts`), so a slow one delays the next tick but
 * never the requests arriving meanwhile.
 */
const POLL_BUSY_MS = 4000;
const POLL_IDLE_MS = 20_000;

export class BoardPoller {
  private timer: NodeJS.Timeout | null = null;
  /** When the scheduled tick fires, so `hurry` can tell whether it is too far off. */
  private nextAt = 0;
  /** A tick's reads are out on the reader thread. */
  private ticking = false;

  constructor(
    private readonly hub: LiveHub,
    private readonly sync: OpenCodeSync
  ) {}

  /** Run one tick now, then keep scheduling. `delay` overrides the next wait. */
  schedule(delay?: number): void {
    if (this.timer) clearTimeout(this.timer);
    const wait = delay ?? (this.hub.hasClients() && this.anySessionBusy() ? POLL_BUSY_MS : POLL_IDLE_MS);
    // The next wait starts when this tick's reads are done, not when it began.
    this.nextAt = Date.now() + wait;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.ticking = true;
      void this.tick().finally(() => {
        this.ticking = false;
        this.schedule();
      });
    }, wait);
    this.timer.unref();
  }

  /**
   * A turn just started or ended. The cadence is only chosen when a tick runs,
   * so an idle board would otherwise sit out its whole idle wait: a short turn
   * could finish, and OpenCode name its session, before the poll looked once.
   */
  hurry(): void {
    // A tick in flight reschedules itself when its reads land, and will pick
    // the busy cadence then; a second timer now could start an overlapping tick.
    if (this.ticking) return;
    if (this.nextAt - Date.now() > POLL_BUSY_MS) this.schedule(POLL_BUSY_MS);
  }

  private async tick(): Promise<void> {
    if (!this.hub.hasClients()) return;
    await this.step('Session activity sync', () => this.sync.syncRunStates());
    await this.step('OpenCode transcript sync', () => this.sync.refreshOwnedTranscripts());
    await this.step('Session spend refresh', () => this.sync.refreshRunningSpend());
    await this.step('Session title pickup', () => this.sync.refreshPendingTitles());
  }

  /** One poll step must not take the rest of the tick down with it. */
  private async step(what: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (e) {
      console.warn(`[Server] ${what} failed:`, e);
    }
  }

  /** Busy, or just finished and about to be named: either is worth the fast cadence. */
  private anySessionBusy(): boolean {
    const now = Date.now();
    for (const task of taskStore.getTasks()) {
      for (const link of listTaskSessions(task)) {
        if (isSessionBusy(link.runState) || acpManager.isSessionTurnInFlight(link.sessionId)) return true;
        if (awaitsSessionTitle(task, link, now, SESSION_TITLE_SOON_MS)) return true;
      }
    }
    return false;
  }
}
