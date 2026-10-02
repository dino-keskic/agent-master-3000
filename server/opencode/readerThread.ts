import path from 'path';
import { pathToFileURL } from 'url';
import { Worker } from 'node:worker_threads';
import { errorMessage } from '../../shared/errors.js';
import { IS_BUNDLED, SERVER_BUNDLE_DIR } from '../app/appPaths.js';
import { opencodeDbPath } from '../setup/locations.js';
import { READS, ReadName, ReadReply, ReadRequest, runRead } from './reads.js';

/**
 * Running OpenCode database reads on a worker thread, so the event loop keeps
 * serving while they run.
 *
 * Every read the background poll makes goes through here. Inline they were
 * the board's periodic freeze: a few seconds every poll in which no request
 * was answered, so a button pressed then — the folder picker, say — sat until
 * the read finished.
 *
 * One thread, started on first use and kept: it holds its own read handle,
 * and that handle's page cache is most of what makes the next read cheap.
 * Requests queue on it in order. If the thread cannot be started, or keeps
 * dying, reads run inline as they always did — slower to live with, but the
 * board still works.
 */

/** Deaths after which the thread is given up on for the life of the process. */
const MAX_RESTARTS = 3;

type Pending = { name: ReadName; args: unknown[]; resolve: (value: unknown) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let restarts = 0;
let nextId = 1;
const pending = new Map<number, Pending>();

/** The worker entry beside this module: the `.ts` under tsx, its own bundle when built. */
function workerUrl(): URL {
  return IS_BUNDLED
    ? pathToFileURL(path.join(SERVER_BUNDLE_DIR, 'opencodeReader.mjs'))
    : new URL('./readerWorker.ts', import.meta.url);
}

/** The thread died: whatever it was holding is answered inline instead. */
function drainInline(): void {
  const stranded = [...pending.values()];
  pending.clear();
  for (const item of stranded) {
    try {
      item.resolve(runRead(item.name, item.args));
    } catch (e) {
      item.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }
}

function lost(why: string): void {
  if (!worker) return;
  worker = null;
  restarts += 1;
  console.warn(`[OpenCode DB] Reader thread ${why}${restarts > MAX_RESTARTS ? '; reading inline from now on' : ''}`);
  drainInline();
}

function thread(): Worker | null {
  if (worker) return worker;
  if (restarts > MAX_RESTARTS) return null;
  try {
    const started = new Worker(workerUrl(), { name: 'opencode-reader' });
    started.on('message', (reply: ReadReply) => {
      const item = pending.get(reply.id);
      if (!item) return;
      pending.delete(reply.id);
      if (pending.size === 0) started.unref();
      if (reply.error !== undefined) item.reject(new Error(reply.error));
      else item.resolve(reply.value);
    });
    started.on('error', (e: unknown) => lost(`failed: ${errorMessage(e) ?? 'unknown error'}`));
    started.on('exit', (code) => lost(`exited (${code})`));
    // An idle reader must not keep a finished process — or a test file —
    // alive; one with a read out must, or the answer is never waited for.
    started.unref();
    worker = started;
    return started;
  } catch (e) {
    restarts = MAX_RESTARTS + 1;
    console.warn('[OpenCode DB] Could not start the reader thread; reading inline:', e);
    return null;
  }
}

/** Run one of `READS` off the main thread, with the database the main thread resolves now. */
export function readOffThread<N extends ReadName>(
  name: N,
  ...args: Parameters<(typeof READS)[N]>
): Promise<ReturnType<(typeof READS)[N]>> {
  type Result = ReturnType<(typeof READS)[N]>;
  const target = thread();
  if (!target) return Promise.resolve().then(() => runRead(name, args) as Result);
  const id = nextId++;
  return new Promise<Result>((resolve, reject) => {
    if (pending.size === 0) target.ref();
    pending.set(id, { name, args, resolve: resolve as (value: unknown) => void, reject });
    const request: ReadRequest = { id, name, args, dbPath: opencodeDbPath() };
    target.postMessage(request);
  });
}
