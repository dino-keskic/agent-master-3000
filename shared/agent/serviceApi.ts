/**
 * The shapes OpenCode 2's background service speaks, turned into the ones the
 * board already uses for `opencode acp`.
 *
 * The service transport (`server/acp/serviceTransport.ts`) answers the same
 * ACP requests the board has always sent, so the rest of the board does not
 * know which driver it is talking to. Every decision in that answering — what
 * the service file says, which rules carry the tool policy, what a model list
 * looks like as `configOptions`, what text a prompt is — lives here, where it
 * can be tested without a service. What belongs here: pure mapping between the
 * two vocabularies, nothing that reads a file or makes a request.
 */

/** What `$XDG_STATE_HOME/opencode/service.json` says about the running service. */
export interface ServiceFile {
  url: string;
  /** Basic-auth password, user `opencode`. A credential: never log it. */
  password: string;
  pid?: number;
  version?: string;
  id?: string;
}

/** The service file's contents, or undefined when it is not one the board can use. */
export function parseServiceFile(text: string): ServiceFile | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.url !== 'string' || !/^https?:\/\//.test(r.url) || typeof r.password !== 'string') return undefined;
  return {
    url: r.url.replace(/\/+$/, ''),
    password: r.password,
    pid: typeof r.pid === 'number' ? r.pid : undefined,
    version: typeof r.version === 'string' ? r.version : undefined,
    id: typeof r.id === 'string' ? r.id : undefined
  };
}

/** The `Authorization` header for the service. */
export function serviceAuthHeader(password: string): string {
  return `Basic ${btoa(`opencode:${password}`)}`;
}

export interface PermissionRule {
  action: string;
  resource: string;
  effect: 'allow' | 'deny' | 'ask';
}

/**
 * The board's tool switches as session rules. The service ignores the
 * `permission` block of `opencode.json` for the sessions it is asked to make,
 * but applies the rules a session is created with — so a switched-off tool is
 * a deny on every resource. Only denies: what is allowed or asked is left to
 * OpenCode's own defaults and the user's config, as it is under `opencode acp`.
 */
export function permissionRules(policy: Record<string, boolean>): PermissionRule[] {
  return Object.entries(policy)
    .filter(([, enabled]) => enabled === false)
    .map(([tool]) => ({ action: tool, resource: '*', effect: 'deny' as const }))
    .sort((a, b) => a.action.localeCompare(b.action));
}

/** A model as the service names it. */
export interface ModelRef {
  id: string;
  providerID: string;
  variant?: string;
}

/** A row of `GET /api/model`. */
export interface ServiceModel {
  id: string;
  modelID?: string;
  providerID: string;
  name?: string;
  enabled?: boolean;
  variants?: { id: string }[];
}

/** A row of `GET /api/agent`. */
export interface ServiceAgent {
  id: string;
  name?: string;
  description?: string;
  mode?: string;
  hidden?: boolean;
}

/** The value the board's model dropdown stores: `provider/model`. */
export function modelValue(model: { providerID: string; id: string }): string {
  return `${model.providerID}/${model.id}`;
}

/** `provider/model` back into a ref; the model id itself may contain slashes. */
export function parseModelValue(value: string): ModelRef | undefined {
  const at = value.indexOf('/');
  if (at <= 0 || at === value.length - 1) return undefined;
  return { providerID: value.slice(0, at), id: value.slice(at + 1) };
}

/** What `effort` reads as when the model runs without a variant. */
export const DEFAULT_EFFORT = 'default';

export interface ConfigOptionShape {
  id: string;
  currentValue?: string;
  options?: { value: string; name?: string; description?: string }[];
}

export interface ServiceSessionState {
  model?: ModelRef;
  agent?: string;
}

/**
 * The service's lists as the `configOptions` an ACP session reports: `model`
 * (enabled models), `mode` (agents a user can pick — not subagents, not
 * hidden ones) and `effort` (the current model's variants, after `default`).
 */
export function synthesizeConfigOptions(
  models: ServiceModel[],
  agents: ServiceAgent[],
  state: ServiceSessionState
): ConfigOptionShape[] {
  const usable = models.filter((m) => m.enabled !== false);
  const current = state.model;
  const model = current
    ? usable.find((m) => m.providerID === current.providerID && (m.id === current.id || m.modelID === current.id))
    : undefined;
  const pickable = agents.filter((a) => !a.hidden && a.mode !== 'subagent');
  const variants = model?.variants ?? [];
  return [
    {
      id: 'model',
      currentValue: current ? modelValue(current) : undefined,
      options: usable.map((m) => ({ value: modelValue(m), name: m.name || m.id }))
    },
    {
      id: 'mode',
      currentValue: state.agent,
      options: pickable.map((a) => ({ value: a.id, name: a.name || a.id, description: a.description }))
    },
    {
      id: 'effort',
      currentValue: current?.variant || DEFAULT_EFFORT,
      options: variants.length
        ? [{ value: DEFAULT_EFFORT, name: 'Default' }, ...variants.map((v) => ({ value: v.id, name: v.id }))]
        : []
    }
  ];
}

/**
 * What the session's state becomes when one config option is set: a model
 * keeps no variant from another model, an effort is the current model's
 * variant, an agent is an agent.
 */
export function applyConfigValue(
  state: ServiceSessionState,
  configId: string,
  value: string
): ServiceSessionState | undefined {
  if (configId === 'model') {
    const ref = parseModelValue(value);
    return ref ? { ...state, model: ref } : undefined;
  }
  if (configId === 'mode') return { ...state, agent: value };
  if (configId === 'effort') {
    if (!state.model) return undefined;
    const { variant: _old, ...model } = state.model;
    return { ...state, model: value === DEFAULT_EFFORT || value === 'none' ? model : { ...model, variant: value } };
  }
  return undefined;
}

/** A prompt's ACP content blocks as the service's `{text, files}`. */
export function promptInput(blocks: unknown): { text: string; files?: { uri: string; name?: string }[] } {
  const list = Array.isArray(blocks) ? blocks : [];
  const text: string[] = [];
  const files: { uri: string; name?: string }[] = [];
  for (const block of list as (Record<string, unknown> | null)[]) {
    if (block?.type === 'text' && typeof block.text === 'string') text.push(block.text);
    else if (block?.type === 'image' && typeof block.data === 'string') {
      const mime = typeof block.mimeType === 'string' ? block.mimeType : 'image/png';
      files.push({ uri: `data:${mime};base64,${block.data}`, ...(typeof block.uri === 'string' ? { name: block.uri } : {}) });
    }
  }
  return files.length ? { text: text.join('\n\n'), files } : { text: text.join('\n\n') };
}

/** A row of `GET /api/session`. */
export interface ServiceSession {
  id: string;
  parentID?: string;
  title?: string;
  agent?: string;
  model?: ModelRef;
  location?: { directory?: string };
  time?: { created?: number; updated?: number; archived?: number };
}

/** `GET /api/session` as ACP's `session/list` answer: root sessions, optionally in one folder. */
export function sessionListResult(sessions: ServiceSession[], cwd?: string) {
  return {
    sessions: sessions
      .filter((s) => !s.parentID && !s.time?.archived)
      .filter((s) => !cwd || s.location?.directory === cwd)
      .map((s) => ({
        sessionId: s.id,
        title: s.title,
        cwd: s.location?.directory,
        updatedAt: s.time?.updated ? new Date(s.time.updated).toISOString() : undefined,
        agent: s.agent
      }))
  };
}

/** The sessions `GET /api/session/active` says are running. */
export function activeSessionIds(body: unknown): string[] {
  const data = (body as { data?: Record<string, { type?: string } | null> } | undefined)?.data;
  if (!data || typeof data !== 'object') return [];
  return Object.entries(data)
    .filter(([id, state]) => id.startsWith('ses') && state?.type !== 'idle')
    .map(([id]) => id);
}

/** Wait before the `failures`th reconnect in a row: doubling from 500ms to 15s. */
export function reconnectDelay(failures: number): number {
  return Math.min(500 * 2 ** Math.max(0, failures - 1), 15_000);
}

/**
 * Complete `data:` frames out of an SSE buffer, and what is left over. Frames
 * are separated by a blank line; heartbeats and comments carry no data.
 */
export function splitSseFrames(buffer: string): { frames: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n\n');
  const rest = parts.pop() ?? '';
  const frames: string[] = [];
  for (const part of parts) {
    const data = part
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (data) frames.push(data);
  }
  return { frames, rest };
}
