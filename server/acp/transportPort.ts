import type { JsonRpcId } from './schema.js';

/**
 * What the board needs from whatever carries ACP to OpenCode.
 *
 * Two things satisfy it: `AcpTransport`, the `opencode acp` child the board
 * owns (OpenCode 1.x, and 2.x when forced), and `ServiceTransport`, which
 * answers the same requests over OpenCode 2's background service, so a turn
 * keeps running when the board does not. Everything above this — sessions,
 * turns, approvals, the option lists — speaks ACP method names and never
 * knows which one it has. What belongs here: that contract, and nothing else.
 */
export interface TransportPort {
  /** The OpenCode major version, once known. */
  agentMajor(): number | undefined;
  /**
   * True when a new session's first option lists may be OpenCode 2's answer
   * from before it read the folder's config (`opencode acp` on 2.x). The
   * service reads its lists fresh for every answer, so it never does.
   */
  answersEarly(): boolean;
  /** True when settings hold a tool policy the agent has not picked up. */
  policyPending(): boolean;
  /** Hand the agent the current tool policy without a restart; false when that needs one. */
  applyToolPolicyLive(): boolean;
  /** True when an OpenCode config file changed after the agent read them. */
  configPending(): boolean;
  /** Reconnect to the agent; resolves once the old connection is gone. */
  restart(): Promise<void>;
  destroy(): void;
  /** The agent process the board started, if it owns one. */
  pid(): number | undefined;
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
  notify(method: string, params?: unknown): void;
  /** Answer a request the agent is blocked on. */
  respond(id: JsonRpcId, result: unknown): void;
  respondWithError(id: JsonRpcId, code: number, message: string): void;
}

export interface TransportHandlers {
  /** The agent is asking us something and is blocked until we answer. */
  onRequest(id: JsonRpcId, method: string, params: unknown): void;
  /** The agent is telling us something; no reply expected. */
  onNotification(method: string, params: unknown): void;
  /** The agent is gone. Everything keyed to it is now stale. */
  onExit(code: number | null): void;
}

/**
 * Wait for a session's running turn to end, without sending anything — the
 * request a board that restarted uses to adopt a turn the service kept going.
 * Only `ServiceTransport` answers it.
 */
export const AWAIT_TURN_METHOD = '_board/await_turn';
