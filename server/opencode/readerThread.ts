import path from 'path';
import { pathToFileURL } from 'url';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Worker } from 'node:worker_threads';
import { errorMessage } from '../../shared/errors.js';
import { joinInFlight } from '../../shared/http/inFlight.js';
import { IS_BUNDLED, SERVER_BUNDLE_DIR } from '../app/appPaths.js';
import { opencodeDbPath } from '../setup/locations.js';
import { READS, ReadName, ReadReply, ReadRequest, runRead } from './reads.js';

/**
 * Running OpenCode database reads on worker threads, so the event loop keeps
 * serving while they run.
 *
 * Every read the background poll makes goes through here. Inline they were
 * the board's periodic freeze: a few seconds every poll in which no request
 * was answered, so a button pressed then — the folder picker, say — sat until
 * the read finished.
 *
 * Two lanes, each one thread, started on first use and kept: each holds its
 * own read handle, and that handle's page cache is most of what makes the next
 * read cheap. Requests queue on a lane in order.
 *
 * - `background` takes the poll and the spend reads. On a large database a
 *   spend read walks every message of the week and takes tens of seconds.
 * - `interactive` takes what someone is waiting on — the transcript of a task
 *   being opened. On one shared queue it sat behind a spend read or two and a
 *   poll tick, and opening a task took most of a minute.
 *
 * Code that runs `interactively(fn)` sends its reads down the interactive
 * lane, however deep in `fn` they are made. Spend reads stay on `background`
 * regardless: their caches live on that thread.
 *
 * If a lane's thread cannot be started, or keeps dying, its reads run inline
 * as they always did — slower to live with, but the board still works.
 */

/** Deaths after which a lane's thread is given up on for the life of the process. */
const MAX_RESTARTS = 3;

type LaneName = 'background' | 'interactive';
type Pending = { name: ReadName; args: unknown[]; resolve: (value: unknown) => void; reject: (e: Error) => void };

/** Reads whose caches live on the background thread, so they never leave it. */
const BACKGROUND_ONLY = new Set<ReadName>(['boardSpend', 'taskSpend']);

class Lane {
  private worker: Worker | null = null;
  private restarts = 0;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(private readonly name: LaneName) {}

  read(name: ReadName, args: unknown[]): Promise<unknown> {
    const target = this.thread();
    if (!target) return Promise.resolve().then(() => runRead(name, args));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      if (this.pending.size === 0) target.ref();
      this.pending.set(id, { name, args, resolve, reject });
      const request: ReadRequest = { id, name, args, dbPath: opencodeDbPath() };
      target.postMessage(request);
    });
  }

  /** The thread died: whatever it was holding is answered inline instead. */
  private drainInline(): void {
    const stranded = [...this.pending.values()];
    this.pending.clear();
    for (const item of stranded) {
      try {
        item.resolve(runRead(item.name, item.args));
      } catch (e) {
        item.reject(e instanceof Error ? e : new Error(String(e)));
      }
    }
  }

  private lost(why: string): void {
    if (!this.worker) return;
    this.worker = null;
    this.restarts += 1;
    console.warn(`[OpenCode DB] ${this.name} reader thread ${why}${this.restarts > MAX_RESTARTS ? '; reading inline from now on' : ''}`);
    this.drainInline();
  }

  private thread(): Worker | null {
    if (this.worker) return this.worker;
    if (this.restarts > MAX_RESTARTS) return null;
    try {
      const started = new Worker(workerUrl(), { name: `opencode-reader-${this.name}` });
      started.on('message', (reply: ReadReply) => {
        const item = this.pending.get(reply.id);
        if (!item) return;
        this.pending.delete(reply.id);
        if (this.pending.size === 0) started.unref();
        if (reply.error !== undefined) item.reject(new Error(reply.error));
        else item.resolve(reply.value);
      });
      started.on('error', (e: unknown) => this.lost(`failed: ${errorMessage(e) ?? 'unknown error'}`));
      started.on('exit', (code) => this.lost(`exited (${code})`));
      // An idle reader must not keep a finished process — or a test file —
      // alive; one with a read out must, or the answer is never waited for.
      started.unref();
      this.worker = started;
      return started;
    } catch (e) {
      this.restarts = MAX_RESTARTS + 1;
      console.warn(`[OpenCode DB] Could not start the ${this.name} reader thread; reading inline:`, e);
      return null;
    }
  }
}

/** The worker entry beside this module: the `.ts` under tsx, its own bundle when built. */
function workerUrl(): URL {
  return IS_BUNDLED
    ? pathToFileURL(path.join(SERVER_BUNDLE_DIR, 'opencodeReader.mjs'))
    : new URL('./readerWorker.ts', import.meta.url);
}

const lanes: Record<LaneName, Lane> = { background: new Lane('background'), interactive: new Lane('interactive') };
const laneContext = new AsyncLocalStorage<LaneName>();

/**
 * Spend reads already out. The board snapshot and the header each ask for the
 * board's, a reload asks again, and a running task's drawer asks for its own
 * on a timer: on a large database each is tens of seconds, and queued one
 * behind another they held every read after them. A second ask joins the first.
 */
const spendInFlight = new Map<string, Promise<unknown>>();

/**
 * What a spend read is joined by: everything but its clock, and a task by its
 * id — a running task's drawer re-reads every few seconds, and the task object
 * itself changes on every status tick.
 */
function spendKey(name: 'boardSpend' | 'taskSpend', args: unknown[]): string {
  const rest = args.filter((_, i) => i !== (name === 'boardSpend' ? 1 : 2));
  if (name === 'taskSpend') rest[0] = (rest[0] as { id?: string } | undefined)?.id;
  return JSON.stringify([name, ...rest]);
}

/** Run `fn` with its reads on the interactive lane: someone is waiting on them. */
export function interactively<T>(fn: () => Promise<T>): Promise<T> {
  return laneContext.run('interactive', fn);
}

/** Run one of `READS` off the main thread, with the database the main thread resolves now. */
export function readOffThread<N extends ReadName>(
  name: N,
  ...args: Parameters<(typeof READS)[N]>
): Promise<ReturnType<(typeof READS)[N]>> {
  type Result = ReturnType<(typeof READS)[N]>;
  const lane = !BACKGROUND_ONLY.has(name) && laneContext.getStore() === 'interactive' ? 'interactive' : 'background';
  if (name !== 'boardSpend' && name !== 'taskSpend') return lanes[lane].read(name, args) as Promise<Result>;
  // A read that started a moment ago is as good as one starting now.
  return joinInFlight(spendInFlight, spendKey(name, args), () => lanes[lane].read(name, args)) as Promise<Result>;
}
