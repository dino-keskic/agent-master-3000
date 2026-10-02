import { parentPort } from 'node:worker_threads';
import { errorMessage } from '../../shared/errors.js';
import { pinDbPath } from './db.js';
import { ReadReply, ReadRequest, runRead } from './reads.js';

/**
 * The reader thread's entry: answers `READS` requests from the main thread,
 * one at a time, on its own long-lived read handle. See `readerThread.ts`.
 */
parentPort?.on('message', (request: ReadRequest) => {
  let reply: ReadReply;
  try {
    pinDbPath(request.dbPath);
    reply = { id: request.id, value: runRead(request.name, request.args) };
  } catch (e) {
    reply = { id: request.id, error: errorMessage(e) || 'read failed' };
  }
  parentPort?.postMessage(reply);
});
