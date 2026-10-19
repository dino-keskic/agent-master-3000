import {
  activeSessionIds,
  applyConfigValue,
  permissionRules,
  promptInput,
  sessionListResult,
  synthesizeConfigOptions,
  type ModelRef,
  type ServiceAgent,
  type ServiceModel,
  type ServiceSession,
  type ServiceSessionState
} from '../../shared/agent/serviceApi.js';
import {
  historyUpdates,
  snapshotUpdates,
  translateV2Event,
  v2RowEndsTurn,
  type V2Event,
  type V2MessageRow,
  type V2StopReason
} from '../../shared/agent/v2Events.js';
import { connectService, locationQuery, serviceRequest, type ServiceConnection } from '../opencode/service.js';
import { ServiceEventStream } from '../opencode/serviceEvents.js';
import { findRootSessionId } from '../opencode/subagents.js';
import type { JsonRpcId } from './schema.js';
import { currentToolPolicy } from './transport.js';
import { AWAIT_TURN_METHOD, type TransportHandlers, type TransportPort } from './transportPort.js';

/**
 * The board's ACP requests, answered by OpenCode 2's background service.
 *
 * The service runs turns in a process the board does not own, so a turn keeps
 * going when the board stops, and a board that comes back adopts it
 * (`AWAIT_TURN_METHOD`). Everything above this keeps speaking ACP: each
 * request is mapped onto the service's HTTP API, and the one event stream is
 * turned back into `session/update` and `session/request_permission`
 * (`shared/agent/v2Events.ts`). What belongs here: that mapping's I/O. The
 * decisions in it live in `shared/agent/serviceApi.ts`.
 *
 * The service is the user's as much as the board's — their TUI uses it too —
 * so nothing here stops or restarts it, nothing is sent for sessions the board
 * did not make or load, and there is no agent pid to hand out (killing "the
 * agent's" leftover processes would reach into the TUI's).
 */

/** How often a waited-on turn is checked against the service, for an end the stream dropped. */
const SWEEP_MS = 30_000;
/** A turn younger than this is not swept: its prompt may not have reached `active` yet. */
const SWEEP_GRACE_MS = 5_000;
/** How long "this session is not ours" is believed before it is asked again. */
const FOREIGN_TTL_MS = 5_000;
const HISTORY_PAGE = 200;
/** How far back an adopted turn is read; one turn is rarely more messages than this. */
const SNAPSHOT_ROWS = 50;
/** The prompt that ACP agents take as "compact this session". */
const COMPACT_TEXT = '/compact';

interface TurnWaiter {
  since: number;
  resolve: (value: { stopReason: V2StopReason }) => void;
  reject: (err: Error) => void;
}

interface Page<T> {
  data?: T[];
  cursor?: { next?: string | null };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export class ServiceTransport implements TransportPort {
  private conn: Promise<ServiceConnection> | null = null;
  private readonly events: ServiceEventStream;
  /** Root sessions the board made, loaded or is waiting on: the only ones whose events go up. */
  private readonly ours = new Set<string>();
  /** A subagent's session → the root it belongs to. */
  private readonly children = new Map<string, string>();
  /** Sessions found not to be ours, and when. */
  private readonly foreign = new Map<string, number>();
  private readonly state = new Map<string, ServiceSessionState & { cwd?: string }>();
  private readonly waiters = new Map<string, TurnWaiter>();
  /** A permission's id → the session (maybe a subagent's) it must be answered in. */
  private readonly permissions = new Map<string, string>();
  private probeCount = 0;
  private sweepTimer: NodeJS.Timeout;
  private major: number | undefined = 2;

  constructor(private readonly handlers: TransportHandlers) {
    this.events = new ServiceEventStream(() => this.connection(), {
      onEvent: (event) => this.onEvent(event),
      onReconnect: () => void this.sweep(0)
    });
    this.events.start();
    this.sweepTimer = setInterval(() => void this.sweep(SWEEP_GRACE_MS), SWEEP_MS);
    this.sweepTimer.unref();
  }

  agentMajor(): number | undefined {
    return this.major;
  }

  answersEarly(): boolean {
    return false;
  }

  /** Every session is created with the policy of the moment, and the known ones are patched. */
  policyPending(): boolean {
    return false;
  }

  applyToolPolicyLive(): boolean {
    const permissions = permissionRules(currentToolPolicy());
    for (const id of this.ours) {
      if (id.startsWith('probe:')) continue;
      this.call('PATCH', `/api/session/${id}`, { permissions }).catch((e: Error) =>
        console.warn(`[OpenCode service] Could not update ${id}'s tool rules: ${e.message}`)
      );
    }
    return true;
  }

  /** The service reads its config for every answer; there is nothing to go stale. */
  configPending(): boolean {
    return false;
  }

  /** Find the service again and reconnect. The service itself is never touched. */
  restart(): Promise<void> {
    this.conn = null;
    this.events.reconnect();
    return Promise.resolve();
  }

  destroy(): void {
    clearInterval(this.sweepTimer);
    this.events.stop();
  }

  pid(): number | undefined {
    return undefined;
  }

  async request(method: string, params: unknown = {}): Promise<unknown> {
    const p = isRecord(params) ? params : {};
    const sessionId = typeof p.sessionId === 'string' ? p.sessionId : '';
    switch (method) {
      case 'session/new':
        return this.newSession(p);
      case 'session/load':
        return this.loadSession(sessionId);
      case 'session/prompt':
        return this.prompt(sessionId, p.prompt);
      case AWAIT_TURN_METHOD:
        return this.awaitTurn(sessionId);
      case 'session/set_config_option':
        return this.setConfigOption(sessionId, String(p.configId), String(p.value));
      case 'session/list': {
        const cwd = typeof p.cwd === 'string' ? p.cwd : undefined;
        const page = (await this.call('GET', `/api/session?${new URLSearchParams({ limit: '200', order: 'desc' })}`)) as Page<ServiceSession> | undefined;
        return sessionListResult(page?.data ?? [], cwd);
      }
      case 'session/close':
        // Sessions are the user's history; closing one here is only forgetting it.
        this.ours.delete(sessionId);
        this.state.delete(sessionId);
        return {};
      default:
        throw new Error(`The OpenCode service driver does not implement ${method}`);
    }
  }

  notify(method: string, params: unknown = {}): void {
    if (method !== 'session/cancel') return;
    const sessionId = isRecord(params) && typeof params.sessionId === 'string' ? params.sessionId : '';
    if (!sessionId || sessionId.startsWith('probe:')) return;
    this.call('POST', `/api/session/${sessionId}/interrupt`).catch((e: Error) =>
      console.warn(`[OpenCode service] Could not stop ${sessionId}: ${e.message}`)
    );
  }

  respond(id: JsonRpcId, result: unknown): void {
    const outcome = isRecord(result) && isRecord(result.outcome) ? result.outcome : undefined;
    const optionId = outcome?.outcome === 'selected' && typeof outcome.optionId === 'string' ? outcome.optionId : 'reject';
    this.reply(String(id), optionId === 'once' || optionId === 'always' ? optionId : 'reject');
  }

  respondWithError(id: JsonRpcId): void {
    this.reply(String(id), 'reject');
  }

  // --- requests ---

  private connection(): Promise<ServiceConnection> {
    if (!this.conn) {
      const attempt = connectService();
      this.conn = attempt;
      // A failed connect is not kept: the next request tries again.
      attempt.catch(() => {
        if (this.conn === attempt) this.conn = null;
      });
    }
    return this.conn;
  }

  private async call(method: string, path: string, body?: unknown): Promise<unknown> {
    return serviceRequest(await this.connection(), method, path, body);
  }

  private async options(cwd: string | undefined, state: ServiceSessionState) {
    const query = locationQuery(cwd);
    const [models, agents] = await Promise.all([
      this.call('GET', `/api/model${query}`) as Promise<Page<ServiceModel> | undefined>,
      this.call('GET', `/api/agent${query}`) as Promise<Page<ServiceAgent> | undefined>
    ]);
    return synthesizeConfigOptions(models?.data ?? [], agents?.data ?? [], state);
  }

  /** A session's state as the service reports it, filled in from the folder's defaults. */
  private async defaults(cwd: string | undefined, info?: ServiceSession): Promise<ServiceSessionState> {
    let model: ModelRef | undefined = info?.model;
    if (!model) {
      const fallback = (await this.call('GET', `/api/model/default${locationQuery(cwd)}`)) as { data?: ServiceModel | null } | undefined;
      if (fallback?.data) model = { providerID: fallback.data.providerID, id: fallback.data.id };
    }
    return { model, agent: info?.agent };
  }

  private async newSession(p: Record<string, unknown>) {
    const cwd = typeof p.cwd === 'string' ? p.cwd : undefined;
    // The board asks for a session with no MCP servers only to read a folder's
    // lists: answer it from the lists, and leave no session behind in the
    // user's history.
    if (Array.isArray(p.mcpServers) && p.mcpServers.length === 0) {
      const sessionId = `probe:${++this.probeCount}`;
      const state = await this.defaults(cwd);
      this.state.set(sessionId, { ...state, cwd });
      return { sessionId, configOptions: await this.options(cwd, state) };
    }
    const res = (await this.call('POST', '/api/session', {
      location: { directory: cwd },
      permissions: permissionRules(currentToolPolicy())
    })) as { data?: ServiceSession } | undefined;
    const info = res?.data;
    if (!info?.id) throw new Error('OpenCode\'s service did not create a session');
    this.ours.add(info.id);
    const state = await this.defaults(cwd, info);
    this.state.set(info.id, { ...state, cwd });
    return { sessionId: info.id, configOptions: await this.options(cwd, state) };
  }

  /** Like `session/load` over ACP: the session's history goes out as updates before the answer. */
  private async loadSession(sessionId: string) {
    const res = (await this.call('GET', `/api/session/${sessionId}`)) as { data?: ServiceSession } | undefined;
    const info = res?.data;
    if (!info?.id) throw new Error(`OpenCode has no session ${sessionId}`);
    this.ours.add(sessionId);
    const cwd = info.location?.directory;
    const state = await this.defaults(cwd, info);
    this.state.set(sessionId, { ...state, cwd });
    for (const update of historyUpdates(await this.messages(sessionId))) {
      this.handlers.onNotification('session/update', { sessionId, update });
    }
    return { sessionId, configOptions: await this.options(cwd, state) };
  }

  private async messages(sessionId: string): Promise<V2MessageRow[]> {
    const rows: V2MessageRow[] = [];
    let cursor: string | undefined;
    do {
      // A cursor already carries the order: the service refuses both at once.
      const query = new URLSearchParams({ limit: String(HISTORY_PAGE), ...(cursor ? { cursor } : { order: 'asc' }) });
      const page = (await this.call('GET', `/api/session/${sessionId}/message?${query}`)) as Page<V2MessageRow> | undefined;
      rows.push(...(page?.data ?? []));
      cursor = page?.cursor?.next ?? undefined;
    } while (cursor);
    return rows;
  }

  private async prompt(sessionId: string, blocks: unknown) {
    this.ours.add(sessionId);
    const ended = this.wait(sessionId);
    try {
      const input = promptInput(blocks);
      if (input.text.trim() === COMPACT_TEXT && !input.files) await this.call('POST', `/api/session/${sessionId}/compact`);
      else await this.call('POST', `/api/session/${sessionId}/prompt`, input);
    } catch (e) {
      this.settle(sessionId, undefined, e as Error);
    }
    return ended;
  }

  /**
   * Wait on a turn the service is already running — the one a restarted board
   * adopts. What it did while nobody listened goes out first, as the updates
   * the stream would have sent; their log ids make a repeat replace, not add.
   */
  private async awaitTurn(sessionId: string) {
    this.ours.add(sessionId);
    const ended = this.wait(sessionId);
    try {
      const page = (await this.call('GET', `/api/session/${sessionId}/message?order=desc&limit=${SNAPSHOT_ROWS}`)) as Page<V2MessageRow> | undefined;
      for (const update of snapshotUpdates([...(page?.data ?? [])].reverse())) {
        this.handlers.onNotification('session/update', { sessionId, update });
      }
    } catch (e) {
      console.warn(`[OpenCode service] Could not read ${sessionId}'s turn so far: ${(e as Error).message}`);
    }
    void this.sweep(0, sessionId);
    return ended;
  }

  private wait(sessionId: string): Promise<{ stopReason: V2StopReason }> {
    // A turn still waited on is superseded: the service runs one at a time.
    this.settle(sessionId, 'cancelled');
    return new Promise((resolve, reject) => this.waiters.set(sessionId, { since: Date.now(), resolve, reject }));
  }

  private settle(sessionId: string, stopReason?: V2StopReason, error?: Error): void {
    const waiter = this.waiters.get(sessionId);
    if (!waiter) return;
    this.waiters.delete(sessionId);
    if (error) waiter.reject(error);
    else waiter.resolve({ stopReason: stopReason ?? 'end_turn' });
  }

  /**
   * Settle the waited-on turns the service is no longer running: the stream
   * may have dropped the event that ended them.
   */
  private async sweep(graceMs: number, only?: string): Promise<void> {
    const due = [...this.waiters].filter(([id, w]) => (!only || id === only) && Date.now() - w.since >= graceMs);
    if (!due.length) return;
    let active: Set<string>;
    try {
      active = new Set(activeSessionIds(await this.call('GET', '/api/session/active')));
    } catch {
      return;
    }
    for (const [sessionId, waiter] of due) {
      if (active.has(sessionId) || this.waiters.get(sessionId) !== waiter) continue;
      let stopReason: V2StopReason = 'end_turn';
      try {
        const page = (await this.call('GET', `/api/session/${sessionId}/message?order=desc&limit=1`)) as Page<V2MessageRow> | undefined;
        const last = page?.data?.[0];
        if (last && last.type === 'assistant' && v2RowEndsTurn(last.type, last)) stopReason = 'cancelled';
      } catch {
        // Not running is what matters; how it ended is a nicety.
      }
      if (this.waiters.get(sessionId) === waiter) this.settle(sessionId, stopReason);
    }
  }

  private async setConfigOption(sessionId: string, configId: string, value: string) {
    const current = this.state.get(sessionId);
    if (!current) throw new Error(`Unknown session ${sessionId}`);
    const next = applyConfigValue(current, configId, value);
    if (!next) throw new Error(`Cannot set ${configId} to ${value}`);
    if (!sessionId.startsWith('probe:')) {
      if (configId === 'mode') await this.call('POST', `/api/session/${sessionId}/agent`, { agent: next.agent });
      else await this.call('POST', `/api/session/${sessionId}/model`, { model: next.model });
    }
    this.state.set(sessionId, { ...current, ...next });
    return { configOptions: await this.options(current.cwd, next) };
  }

  private reply(permissionId: string, decision: 'once' | 'always' | 'reject'): void {
    const sessionId = this.permissions.get(permissionId);
    if (!sessionId) return;
    this.permissions.delete(permissionId);
    this.call('POST', `/api/session/${sessionId}/permission/${permissionId}/reply`, { decision }).catch((e: Error) =>
      console.warn(`[OpenCode service] Could not answer permission ${permissionId}: ${e.message}`)
    );
  }

  // --- the event stream ---

  /** The board session an event's session belongs to, or undefined when it is somebody else's. */
  private rootOf(sessionId: string): string | undefined {
    if (this.ours.has(sessionId)) return sessionId;
    const parent = this.children.get(sessionId);
    if (parent) return parent;
    const seen = this.foreign.get(sessionId);
    if (seen && Date.now() - seen < FOREIGN_TTL_MS) return undefined;
    const root = findRootSessionId(sessionId);
    if (root && root !== sessionId && this.ours.has(root)) {
      this.children.set(sessionId, root);
      return root;
    }
    this.foreign.set(sessionId, Date.now());
    return undefined;
  }

  private onEvent(event: V2Event): void {
    for (const out of translateV2Event(event)) {
      const root = this.rootOf(out.sessionId);
      if (!root) continue;
      const isChild = root !== out.sessionId;
      if (out.kind === 'permission') {
        // A subagent's ask is shown on the board session that started it, and
        // answered in the subagent's own.
        this.permissions.set(out.requestId, out.sessionId);
        this.handlers.onRequest(out.requestId, 'session/request_permission', { ...out.params, sessionId: root });
      } else if (isChild) {
        // A subagent's own stream is its tool call in the parent, as over ACP.
        continue;
      } else if (out.kind === 'update') {
        this.handlers.onNotification('session/update', { sessionId: root, update: out.update });
      } else if (out.kind === 'turn_ended') {
        this.settle(root, out.stopReason, out.stopReason === 'refusal' ? new Error(out.error ?? 'The turn failed') : undefined);
      } else if (out.kind === 'permission_settled') {
        // Answered elsewhere — in the TUI, say. The board's card stays until
        // the turn moves on; see the PR's known gaps.
        this.permissions.delete(out.requestId);
      }
    }
  }
}
