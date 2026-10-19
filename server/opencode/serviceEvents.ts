import { reconnectDelay, splitSseFrames } from '../../shared/agent/serviceApi.js';
import type { V2Event } from '../../shared/agent/v2Events.js';
import type { ServiceConnection } from './service.js';

/**
 * The one `/api/event` stream of OpenCode 2's background service, kept open.
 *
 * The stream carries every session the service runs — the user's TUI sessions
 * too — and does not replay what was sent while nobody listened (a
 * `Last-Event-ID` is ignored). So a reconnect is announced (`onReconnect`):
 * whoever is waiting on a turn has to look at the service to learn what it
 * missed. What belongs here: the connection, its framing, and backing off
 * while it keeps failing. What the events mean is `shared/agent/v2Events.ts`.
 */

export interface ServiceEventHandlers {
  onEvent(event: V2Event): void;
  /** Connected again after a drop: events in between are lost. */
  onReconnect(): void;
}

export class ServiceEventStream {
  private abort: AbortController | null = null;
  private failures = 0;
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;
  private connectedOnce = false;

  constructor(
    private readonly connect: () => Promise<ServiceConnection>,
    private readonly handlers: ServiceEventHandlers
  ) {}

  start(): void {
    this.stopped = false;
    if (!this.abort && !this.timer) void this.run();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.abort?.abort();
    this.abort = null;
  }

  /** Drop the connection and open a new one now — after the service moved, say. */
  reconnect(): void {
    this.stop();
    this.failures = 0;
    this.start();
  }

  private async run(): Promise<void> {
    const abort = new AbortController();
    this.abort = abort;
    try {
      const conn = await this.connect();
      const res = await fetch(`${conn.url}/api/event`, {
        headers: { authorization: conn.authorization, accept: 'text/event-stream' },
        signal: abort.signal
      });
      if (!res.ok || !res.body) throw new Error(`event stream answered ${res.status}`);
      this.failures = 0;
      if (this.connectedOnce) this.handlers.onReconnect();
      this.connectedOnce = true;
      await this.read(res.body);
    } catch (e) {
      if (!abort.signal.aborted) {
        // Only the first failure in a row is worth a line: the rest repeat it.
        if (this.failures === 0) console.warn(`[OpenCode service] Event stream lost: ${(e as Error).message}`);
        this.failures++;
      }
    } finally {
      if (this.abort === abort) this.abort = null;
    }
    if (this.stopped) return;
    // A stream that ended cleanly still counts: the service closed it.
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, reconnectDelay(Math.max(1, this.failures)));
    this.timer.unref();
  }

  private async read(body: ReadableStream<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      const { frames, rest } = splitSseFrames(buffer);
      buffer = rest;
      for (const frame of frames) {
        let event: V2Event | null;
        try {
          event = JSON.parse(frame) as V2Event | null;
        } catch {
          continue;
        }
        if (event && typeof event.type === 'string') {
          try {
            this.handlers.onEvent(event);
          } catch (e) {
            console.error('[OpenCode service] Handling an event failed:', e);
          }
        }
      }
    }
  }
}
