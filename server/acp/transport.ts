import { spawn, ChildProcess } from 'child_process';
import readline from 'readline';
import { toolPolicySignature } from '../../shared/agent/tools.js';
import { opencodeEnv } from '../opencode/env.js';
import { childBaseEnv, opencodeBin } from '../setup/locations.js';
import { isIncomingJsonRpcRequest, jsonRpcMessageSchema, JsonRpcId } from './schema.js';

export const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
/** Turns take as long as they take; a timeout here would abandon a live agent. */
export const NO_TIMEOUT = 0;

/** Set ACP_DEBUG=1 to log every inbound ACP method — invaluable when the agent
 *  is not sending something you expect (e.g. permission requests). */
const ACP_DEBUG = process.env.ACP_DEBUG === '1';

const RESTART_DELAY_MS = 3000;
/** How far apart retries get while the agent cannot be started at all. */
const MAX_RESTART_DELAY_MS = 60000;

/**
 * The board's tool policy, read at spawn time.
 *
 * A function rather than a value: the agent process is created lazily on first
 * use, which can happen before — or after — the server has loaded its state.
 */
let toolPolicySource: () => Record<string, boolean> = () => ({});

export function setToolPolicySource(source: () => Record<string, boolean>): void {
  toolPolicySource = source;
}

/**
 * The agent process to speak ACP with: `ACP_COMMAND`, or `acp` on the OpenCode
 * the setup found. Read at spawn time, not module load, so tests can point it
 * at a stub after importing this module, and a moved OpenCode is picked up on
 * the next restart.
 */
function acpCommand(): [string, string[]] {
  if (!process.env.ACP_COMMAND) return [opencodeBin(), ['acp']];
  const [bin = 'opencode', ...args] = process.env.ACP_COMMAND.split(' ').filter(Boolean);
  return [bin, args];
}

export interface AcpTransportHandlers {
  /** The agent is asking us something and is blocked until we answer. */
  onRequest(id: JsonRpcId, method: string, params: unknown): void;
  /** The agent is telling us something; no reply expected. */
  onNotification(method: string, params: unknown): void;
  /** The process died. Everything keyed to it is now stale. */
  onExit(code: number | null): void;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer?: NodeJS.Timeout;
}

/**
 * The `opencode acp` child process and the JSON-RPC wire to it.
 *
 * Nothing here knows what a task or a session is: it owns the process, frames
 * messages, matches replies to their requests, and hands anything inbound to
 * the handlers. That is what makes the manager above it testable against a stub
 * agent — the whole protocol surface is these few methods.
 */
export class AcpTransport {
  private child: ChildProcess | null = null;
  private requestId = 1;
  private readonly pending = new Map<JsonRpcId, PendingCall>();
  /** Signature of the tool policy the running agent process was started with. */
  private appliedToolPolicy = '';
  private destroyed = false;
  private restartTimer: NodeJS.Timeout | null = null;
  /** Why the last spawn failed, while it keeps failing; see `onSpawnFailed`. */
  private spawnError = '';
  private spawnFailures = 0;

  constructor(private readonly handlers: AcpTransportHandlers) {
    this.start();
  }

  /** True when settings hold a tool policy the running agent has not picked up. */
  policyPending(): boolean {
    return toolPolicySignature(toolPolicySource()) !== this.appliedToolPolicy;
  }

  /**
   * Drop the agent process so it comes back with the current tool policy. The
   * exit handler restarts it; sessions are re-loaded on their next turn, which
   * is the same path an agent crash already takes.
   */
  restart(): void {
    if (!this.child) {
      this.start();
      return;
    }
    try {
      this.child.kill();
    } catch {
      /* already gone */
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.failAllPending('ACP manager destroyed');
    if (this.child) {
      try { this.child.kill(); } catch { /* ignore */ }
      this.child = null;
    }
  }

  pid(): number | undefined {
    return this.child?.pid;
  }

  // --- sending ---

  request(method: string, params: unknown = {}, timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS): Promise<unknown> {
    return new Promise((resolve, reject) => {
      // Between a crash and its restart there is no agent; someone asking for
      // one is reason enough not to wait out the delay.
      if (!this.child) this.start();
      if (!this.child || !this.child.stdin) {
        return reject(new Error(this.spawnError ? this.notStarted() : 'ACP process stdin not available'));
      }
      const id = ++this.requestId;

      const timer = timeoutMs > 0
        ? setTimeout(() => {
            if (this.pending.has(id)) {
              this.pending.delete(id);
              reject(new Error(`ACP request timed out for method: ${method}`));
            }
          }, timeoutMs)
        : undefined;

      this.pending.set(id, { resolve, reject, timer });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  /**
   * JSON-RPC notification: no `id`, no reply. `session/cancel` is specified this
   * way — sending it as a request makes OpenCode's SDK look for a request handler
   * it does not have, so the turn never aborts.
   */
  notify(method: string, params: unknown = {}): void {
    if (!this.child?.stdin) {
      console.warn(`[ACP] Cannot send ${method}: stdin not available`);
      return;
    }
    this.write({ jsonrpc: '2.0', method, params });
  }

  /** Result for a request the agent is blocked on. */
  respond(id: JsonRpcId, result: unknown): void {
    this.write({ jsonrpc: '2.0', id, result });
  }

  respondWithError(id: JsonRpcId, code: number, message: string): void {
    this.write({ jsonrpc: '2.0', id, error: { code, message } });
  }

  private write(message: unknown): void {
    this.child?.stdin?.write(JSON.stringify(message) + '\n');
  }

  // --- the process ---

  private start(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    if (this.destroyed || this.child) return;
    try {
      const [bin, args] = acpCommand();
      const policy = toolPolicySource();
      this.appliedToolPolicy = toolPolicySignature(policy);
      const child = spawn(bin, args, {
        stdio: ['pipe', 'pipe', 'inherit'],
        env: opencodeEnv(childBaseEnv(), policy)
      });
      this.child = child;

      if (!this.child.stdout || !this.child.stdin) {
        console.error('[ACP] Failed to attach stdin/stdout to opencode acp process');
        return;
      }

      this.child.unref();
      // Writing to an agent that already died is EPIPE on the pipe, not on the
      // process; unheard, it takes the whole board down with it. `exit` is what
      // reports the death and restarts it.
      this.child.stdin.on('error', (err: Error) => {
        console.warn('[ACP] Agent stdin closed:', err.message);
      });

      const rl = readline.createInterface({ input: this.child.stdout });
      rl.on('line', (line: string) => this.handleLine(line));

      this.child.on('spawn', () => {
        this.spawnError = '';
        this.spawnFailures = 0;
      });
      this.child.on('exit', (code: number | null) => this.onExit(child, code));
      this.child.on('error', (err: Error) => {
        console.error('[ACP] opencode acp process error:', err.message);
        if (child.pid === undefined) this.onSpawnFailed(child, err);
        else this.failAllPending(`opencode acp process error: ${err.message}`);
      });

      void this.request('initialize', {
        protocolVersion: 1,
        clientInfo: { name: 'agent-master-3000', version: '1.0.0' },
        capabilities: {}
      }).then(() => {
        console.log('[ACP] Initialized successfully with OpenCode ACP server');
      }).catch((err) => {
        console.error('[ACP] Initialize failed:', err);
      });
    } catch (e) {
      console.error('[ACP] Process spawn error:', e);
    }
  }

  private onExit(child: ChildProcess, code: number | null): void {
    if (this.child !== child) return;
    // Dropped, not kept: a request written to a dead process's stdin was never
    // answered, and a turn has no timeout to end it.
    this.child = null;
    this.handlers.onExit(code);
    this.failAllPending(`opencode acp process exited (code ${code}) before the request completed`);
    if (this.destroyed) return;
    console.warn(`[ACP] opencode acp process exited with code ${code}`);
    this.scheduleStart(RESTART_DELAY_MS);
  }

  /**
   * The agent never started — no such binary, not executable. Node reports
   * that as `error` with no `exit` to follow, so without this the dead handle
   * stayed in place: every request was written to it and waited out its
   * timeout, a turn hung in "running", and nothing ever tried again. Now the
   * handle is dropped, requests fail at once saying why, and the spawn is
   * retried — on the next request, and on a timer further apart each time.
   */
  private onSpawnFailed(child: ChildProcess, err: Error): void {
    if (this.child !== child) return;
    this.child = null;
    this.spawnError = err.message;
    this.spawnFailures += 1;
    this.failAllPending(this.notStarted());
    if (this.destroyed) return;
    this.scheduleStart(Math.min(RESTART_DELAY_MS * 2 ** (this.spawnFailures - 1), MAX_RESTART_DELAY_MS));
  }

  private notStarted(): string {
    return `The agent could not be started (${this.spawnError}). Is OpenCode installed? Settings → Locations shows where the board looks for it.`;
  }

  private scheduleStart(delayMs: number): void {
    if (this.restartTimer) return;
    this.restartTimer = setTimeout(() => this.start(), delayMs);
    this.restartTimer.unref();
  }

  // --- receiving ---

  private handleLine(line: string): void {
    if (!line.trim()) return;
    try {
      const envelope = jsonRpcMessageSchema.safeParse(JSON.parse(line));
      if (!envelope.success) {
        console.warn('[ACP] Ignoring malformed JSON-RPC line:', line.slice(0, 200));
        return;
      }
      const msg = envelope.data;
      if (ACP_DEBUG && msg.method) {
        console.log(`[ACP<-] ${msg.method}${msg.id !== undefined ? ` (request #${msg.id})` : ''}`,
          JSON.stringify(msg.params).slice(0, 400));
      }

      // Requests first: JSON-RPC ids are per sender, so an in-flight
      // `session/prompt` can share a numeric id with `session/request_permission`.
      if (isIncomingJsonRpcRequest(msg)) {
        this.handlers.onRequest(msg.id, msg.method, msg.params);
        return;
      }

      if (msg.id !== undefined && this.pending.has(msg.id)) {
        this.settle(msg.id, msg.error, msg.result);
        return;
      }

      if (msg.method) this.handlers.onNotification(msg.method, msg.params);
    } catch (e) {
      console.error('[ACP] Raw Output Parse Error:', line, e);
    }
  }

  private settle(id: JsonRpcId, error: { message?: string } | undefined, result: unknown): void {
    const call = this.pending.get(id);
    if (!call) return;
    this.pending.delete(id);
    if (call.timer) clearTimeout(call.timer);
    if (error) call.reject(new Error(error.message || 'JSON-RPC Error'));
    else call.resolve(result);
  }

  private failAllPending(reason: string): void {
    const calls = [...this.pending.values()];
    this.pending.clear();
    for (const { reject, timer } of calls) {
      if (timer) clearTimeout(timer);
      reject(new Error(reason));
    }
  }
}
