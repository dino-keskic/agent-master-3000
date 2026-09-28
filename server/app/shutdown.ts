import http from 'http';
import { WebSocketServer } from 'ws';
import { acpManager } from '../acp/client.js';
import { taskStore } from '../board/taskStore.js';

/**
 * How the board process ends.
 *
 * Node dies on SIGINT/SIGTERM without running `exit` handlers, so without this
 * Ctrl-C, `docker stop` and a `tsx watch` restart all dropped the last half
 * second of board state and the last two seconds of transcript, and left the
 * agent process to notice on its own that nobody was reading its stdout.
 *
 * Everything here is synchronous on purpose: the state write is, and a
 * shutdown that awaits is one a second signal can interrupt halfway.
 */

let stopping = false;

function stop(server: http.Server, wss: WebSocketServer, reason: string): void {
  if (stopping) return;
  stopping = true;
  console.log(`[Server] ${reason}; shutting down`);
  try { server.close(); } catch { /* ignore */ }
  for (const client of wss.clients) {
    try { client.terminate(); } catch { /* ignore */ }
  }
  try { acpManager.destroy(); } catch (e) { console.error('[Server] Could not stop the agent process:', e); }
  try { taskStore.flush(); } catch (e) { console.error('[Server] Could not save the board on the way out:', e); }
}

export function installShutdown(server: http.Server, wss: WebSocketServer): void {
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => {
      // A second Ctrl-C while the first is still saving means "now".
      if (stopping) process.exit(1);
      stop(server, wss, signal);
      process.exit(signal === 'SIGINT' ? 130 : 143);
    });
  }

  // A rejected promise nobody awaited is a bug, but in one background task —
  // a poll, a probe, a late agent reply — not a reason to drop every running
  // turn on the board. Say so loudly and keep serving.
  process.on('unhandledRejection', (reason) => {
    console.error('[Server] Unhandled promise rejection:', reason);
  });

  // A throw that reached the top of the stack left state nobody can vouch for,
  // so the process does end — but with the board saved and the agent stopped.
  process.on('uncaughtException', (err) => {
    console.error('[Server] Uncaught exception:', err);
    stop(server, wss, 'uncaught exception');
    process.exit(1);
  });
}
