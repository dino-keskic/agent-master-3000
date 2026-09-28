import { WebSocket, WebSocketServer } from 'ws';
import { BoardTask, TaskSessionLink, WebSocketMessage } from '../../shared/types.js';
import { collectActiveTools } from '../../shared/agent/backgroundTasks.js';

/**
 * The same task, with every transcript removed.
 *
 * A task's logs run to hundreds of kilobytes, and a streamed turn pushes a
 * snapshot per event — so shipping the transcript with each one dwarfed the
 * events themselves and made the first paint wait on megabytes. Lists and
 * pushes carry the marker instead; the client keeps the transcript it already
 * holds and asks `GET /api/tasks/:id` for the whole thing when it needs one.
 */
export function stripLogs(task: BoardTask): BoardTask {
  const activeTools = collectActiveTools(task);
  return {
    ...task,
    logs: [],
    logsOmitted: true,
    activeTools: activeTools.length ? activeTools : undefined,
    sessions: task.sessions?.map((link) => {
      const stripped: TaskSessionLink = { ...link, logsOmitted: true };
      delete stripped.logs;
      return stripped;
    })
  };
}

/** How far behind a client may fall before it is cut off; see `sendPayload`. */
const MAX_BUFFERED_BYTES = 32 * 1024 * 1024;

/**
 * The set of attached browsers, and the only place a message reaches them.
 *
 * Stripping happens here rather than at each of the forty send sites, so it is
 * a property of the transport and not something every caller has to remember.
 * `TASK_LOG` keeps its own `log`: the delta is what the client appends.
 */
export class LiveHub {
  private readonly clients = new Set<WebSocket>();

  /**
   * @param onFirstClient Ticks are skipped while nothing is attached, so the
   *   first client back has to be caught up rather than left waiting out a
   *   full idle delay.
   */
  constructor(private readonly onFirstClient: () => void) {}

  listen(wss: WebSocketServer): void {
    wss.on('connection', (ws: WebSocket) => {
      const wasIdle = this.clients.size === 0;
      this.clients.add(ws);
      console.log('[WS] Client connected. Total:', this.clients.size);
      if (wasIdle) this.onFirstClient();
      ws.on('close', () => {
        this.clients.delete(ws);
        console.log('[WS] Client disconnected. Total:', this.clients.size);
      });
      // A malformed frame or a reset connection is an `error` on the socket,
      // and `ws` throws one nobody listens for. `close` follows it.
      ws.on('error', (err) => {
        console.warn('[WS] Client socket error:', err.message);
      });
    });
    wss.on('error', (err) => {
      console.error('[WS] Server error:', err.message);
    });
  }

  /** Whether anyone is listening — the poll skips its work when nobody is. */
  hasClients(): boolean {
    return this.clients.size > 0;
  }

  send(msg: WebSocketMessage): void {
    if (this.clients.size === 0) return;
    this.sendPayload(JSON.stringify('task' in msg ? { ...msg, task: stripLogs(msg.task) } : msg));
  }

  /** The send half of `send`, for callers that have already serialised. */
  sendPayload(payload: string): void {
    for (const client of this.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      // A client that stopped reading (a laptop asleep, a tab frozen in the
      // background) would otherwise have every push queued for it in this
      // process. Cut it off; it reconnects and reloads the board when it wakes.
      if (client.bufferedAmount > MAX_BUFFERED_BYTES) {
        console.warn('[WS] Dropping a client that stopped reading');
        client.terminate();
        continue;
      }
      client.send(payload);
    }
  }
}
