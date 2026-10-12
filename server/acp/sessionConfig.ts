import { OpenCodeAgent, OpenCodeModel } from '../../shared/sessions/types.js';
import { BoardTask, SessionChoice } from '../../shared/types.js';
import { sessionRunSettings } from '../../shared/task/sessions.js';
import { mergeFolderModels } from '../../shared/agent/modelScope.js';
import { agentIdGuesses, mayBeEarlyAgentList } from '../../shared/agent/agents.js';
import {
  ConfigOption,
  findOption,
  optionValues,
  resolveConfigValue,
  sessionResultSchema
} from './schema.js';
import { AcpEvent, configInfo, configWarning } from './events.js';
import { AcpSessionRegistry } from './sessionRegistry.js';
import { AcpTransport } from './transport.js';

const CONFIG_CACHE_TTL_MS = 60000;
/** A probe answers in milliseconds even mid-turn; longer means the agent is wedged. */
const PROBE_TIMEOUT_MS = 8000;
/**
 * How long to wait before each re-read of a session whose lists lack a value.
 * The first is immediate: in the sandbox, OpenCode 2 had read the folder's
 * agents by the very next request. The rest cover a slow disk, ~2s in all.
 */
const REREAD_DELAYS_MS = [0, 250, 500, 1000];
/**
 * How long a session whose first lists may be OpenCode 2's early answer waits
 * for the real ones to be pushed. In the sandbox they came 80–120ms later; but
 * none come at all when the real list is the early one, so this is also what a
 * user with no agents of their own pays — once, after which `knownAgents` says
 * there is nothing to wait for.
 */
export const EARLY_LIST_WAIT_MS = 3000;
/** Pushes kept for sessions not yet known to the board; see `onPushed`. */
const UNCLAIMED_PUSH_CAP = 32;

export interface AcpConfigOptionsResult {
  models: OpenCodeModel[];
  agents: OpenCodeAgent[];
  effortLevels: { value: string; name: string }[];
  current: { model?: string; agent?: string; effortLevel?: string };
}

/** What the board shows when there is nothing to offer yet. */
export function emptyConfigOptions(): AcpConfigOptionsResult {
  return { models: [], agents: [], effortLevels: [], current: {} };
}

/**
 * OpenCode's raw config options as the board's model/agent/effort lists.
 *
 * Pure, so the shape of what the composer offers can be tested without an
 * agent process: the three dropdowns are all one `configOptions` array read
 * three different ways.
 */
export function describeConfigOptions(options: ConfigOption[]): AcpConfigOptionsResult {
  const modelOpt = findOption(options, 'model');
  const modeOpt = findOption(options, 'mode');
  const effortOpt = findOption(options, 'effort');

  return {
    models: (modelOpt?.options ?? []).map((o): OpenCodeModel => ({
      id: o.value,
      name: o.name || o.value,
      provider: o.value.split('/')[0] || 'OpenCode'
    })),
    agents: (modeOpt?.options ?? []).map((o): OpenCodeAgent => ({
      name: o.value,
      description: o.description || o.name || o.value
    })),
    effortLevels: (effortOpt?.options ?? []).map((o) => ({ value: o.value, name: o.name || o.value })),
    current: {
      model: modelOpt?.currentValue,
      agent: modeOpt?.currentValue,
      effortLevel: effortOpt?.currentValue
    }
  };
}

interface Probe {
  id: string;
  baseOptions: ConfigOption[];
  /** One read at a time per probe: each read switches its model. */
  queue: Promise<unknown>;
}

/**
 * The composer's model/agent/thinking settings, pushed onto OpenCode sessions.
 *
 * Two jobs that share the same `configOptions` vocabulary: telling the board
 * what a model *offers* (the dropdowns), and making one specific session run as
 * what the user picked. The second is the one with teeth — a follow-up that
 * skipped it is how a selected model quietly kept running as the old one.
 */
export class SessionConfigurator {
  private readonly cache = new Map<string, { result: AcpConfigOptionsResult; fetchedAt: number }>();
  /** Each model's raw lists, as a live session last reported them. */
  private readonly learned = new Map<string, { options: ConfigOption[]; fetchedAt: number }>();
  /**
   * Throwaway sessions that exist only to read the option lists from, one per
   * folder: a project's own `opencode.json` adds models for sessions in that
   * project and nowhere else.
   */
  private readonly probes = new Map<string, Promise<Probe>>();
  /** The same probes by session id, for the lists OpenCode pushes to them. */
  private readonly probeSessions = new Map<string, Probe>();
  /** Agent names from lists known to be real: what an early list is short of. */
  private readonly knownAgents = new Set<string>();
  /** Sessions waiting on `realLists` for OpenCode to push their lists. */
  private readonly pushWaiters = new Map<string, (options: ConfigOption[]) => void>();
  /**
   * Pushes for sessions nobody had claimed yet. A session's reply and the push
   * that follows it can come in one read from the pipe, and then the push is
   * handled before whoever asked for the session has seen the reply.
   */
  private readonly unclaimedPushes = new Map<string, ConfigOption[]>();

  constructor(
    private readonly transport: AcpTransport,
    private readonly registry: AcpSessionRegistry,
    private readonly emit: (taskId: string, event: AcpEvent) => void,
    /** Lists the board already handed out turned out to be early; it should ask again. */
    private readonly onListsChanged: () => void = () => {},
    private readonly earlyListWaitMs: number = EARLY_LIST_WAIT_MS
  ) {}

  /** The agent process is gone; its probe sessions and cached lists went with it. */
  reset(): void {
    this.probes.clear();
    this.probeSessions.clear();
    this.cache.clear();
    this.learned.clear();
    this.knownAgents.clear();
    this.unclaimedPushes.clear();
    // Whoever waits gets nothing more from a dead process; the timeout ends it.
  }

  // --- reading what is on offer ---

  /**
   * What `modelId` offers — or, without one, the default model's — with the
   * model list merged across `folders`. A model some folders lack is read in
   * the first folder that has it.
   */
  async fetchOptions(modelId?: string, folders: readonly string[] = [process.cwd()]): Promise<AcpConfigOptionsResult> {
    const cacheKey = `${modelId || '__default__'}\0${folders.join('\0')}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CONFIG_CACHE_TTL_MS) return cached.result;

    // Requests are multiplexed by id, so a running turn does not block this —
    // OpenCode answers a probe mid-stream in milliseconds. The timeout only
    // keeps a wedged agent from stalling the board; stale lists beat none.
    try {
      const opened = await this.openAll(folders);
      if (opened.length === 0) throw new Error('Could not create an ACP session to read configuration options');
      const models = mergeFolderModels(
        opened.map(({ folder, probe }) => ({ folder, models: describeConfigOptions(probe.baseOptions).models }))
      );
      const options = modelId
        ? this.learnedOptions(modelId) ?? await this.readModel(opened, modelId)
        : opened[0]!.probe.baseOptions;
      const result = { ...describeConfigOptions(options), models };
      this.cache.set(cacheKey, { result, fetchedAt: Date.now() });
      this.learn(options);
      return result;
    } catch (e) {
      console.error('[ACP] Error fetching config options:', e);
      return cached?.result || emptyConfigOptions();
    }
  }

  /** The probes for `folders` that could be opened, in the order given. A folder that fails is left out. */
  private async openAll(folders: readonly string[]): Promise<{ folder: string; probe: Probe }[]> {
    const settled = await Promise.all(
      folders.map((folder) =>
        this.probeFor(folder).then(
          (probe) => ({ folder, probe }),
          (e: Error) => {
            console.warn(`[ACP] Could not read OpenCode's options in ${folder}: ${e.message}`);
            return null;
          }
        )
      )
    );
    return settled.filter((x): x is { folder: string; probe: Probe } => !!x);
  }

  private probeFor(folder: string): Promise<Probe> {
    let probe = this.probes.get(folder);
    if (!probe) {
      probe = this.transport
        .request('session/new', { cwd: folder, mcpServers: [] }, PROBE_TIMEOUT_MS)
        .then(async (raw) => {
          const created = sessionResultSchema.parse(raw);
          if (!created.sessionId) throw new Error('OpenCode did not open a session');
          const opened: Probe = { id: created.sessionId, baseOptions: created.configOptions ?? [], queue: Promise.resolve() };
          this.probeSessions.set(opened.id, opened);
          opened.baseOptions = await this.realLists(opened.id, opened.baseOptions);
          return opened;
        });
      // A failed open is not remembered: the next read tries again.
      probe.catch(() => this.probes.delete(folder));
      this.probes.set(folder, probe);
    }
    return probe;
  }

  /**
   * A new session's lists, once they can be believed. OpenCode 2 answers a
   * folder's first session before it has read that folder's config — `build`
   * and `plan`, even when the user disabled them, and none of the user's own
   * agents — then pushes the real lists (`config_option_update`) a moment
   * later, but only if they differ. A list that may be that early answer waits
   * for the push; 1.x never answers early, so nothing there waits.
   */
  private async realLists(sessionId: string, first: ConfigOption[]): Promise<ConfigOption[]> {
    const stashed = this.unclaimedPushes.get(sessionId);
    if (stashed) {
      this.unclaimedPushes.delete(sessionId);
      return stashed;
    }
    if (!this.mayBeEarly(first)) {
      this.trust(first);
      return first;
    }
    const pushed = await new Promise<ConfigOption[] | undefined>((resolve) => {
      const timer = setTimeout(() => {
        this.pushWaiters.delete(sessionId);
        resolve(undefined);
      }, this.earlyListWaitMs);
      timer.unref();
      this.pushWaiters.set(sessionId, (options) => {
        clearTimeout(timer);
        resolve(options);
      });
    });
    if (pushed) return pushed;
    // Nothing came, so the first answer was the real one.
    this.trust(first);
    return first;
  }

  /** True when `options` may be OpenCode 2's answer from before it read the folder's config. */
  private mayBeEarly(options: ConfigOption[]): boolean {
    if ((this.transport.agentMajor() ?? 2) < 2) return false;
    return mayBeEarlyAgentList(optionValues(options, 'mode'), this.knownAgents.size ? this.knownAgents : undefined);
  }

  private trust(options: ConfigOption[]): void {
    for (const name of optionValues(options, 'mode')) this.knownAgents.add(name);
  }

  /**
   * Lists OpenCode pushed for a session (`config_option_update`). A push comes
   * after OpenCode has read the folder's config, so its agents are real. For a
   * probe they replace its own lists only while it is still on the model it
   * opened with — a probe switched to read another model is reporting that
   * model's.
   */
  onPushed(sessionId: string, options: ConfigOption[]): void {
    this.trust(options);
    const waiter = this.pushWaiters.get(sessionId);
    if (waiter) {
      this.pushWaiters.delete(sessionId);
      waiter(options);
    }
    const probe = this.probeSessions.get(sessionId);
    if (probe) {
      const model = findOption(options, 'model')?.currentValue;
      if (model && model === findOption(probe.baseOptions, 'model')?.currentValue) {
        probe.baseOptions = options;
        this.cache.clear();
        // Without a waiter the probe already answered with its early lists,
        // and the composer is showing them.
        if (!waiter) this.onListsChanged();
      }
    } else if (this.registry.configOptions(sessionId)) {
      this.registry.setConfigOptions(sessionId, options);
    } else if (!waiter) {
      this.unclaimedPushes.set(sessionId, options);
      if (this.unclaimedPushes.size > UNCLAIMED_PUSH_CAP) {
        this.unclaimedPushes.delete(this.unclaimedPushes.keys().next().value!);
      }
    }
    this.learn(options);
  }

  /**
   * The raw options for `modelId`, from the first probe whose folder offers it.
   * Reads on one probe are queued: two dropdowns loading different models
   * must not interleave their switches.
   */
  private readModel(opened: readonly { probe: Probe }[], modelId: string): Promise<ConfigOption[]> {
    // The board may store `provider/id` where OpenCode lists a bare id, or the
    // other way round.
    const match = opened
      .map(({ probe }) => ({ probe, target: resolveConfigValue(probe.baseOptions, 'model', modelId) }))
      .find((m) => m.target);
    if (!match?.target) return Promise.reject(new Error(`OpenCode does not list model "${modelId}"`));
    const { probe, target } = match;
    const read = probe.queue.then(() => this.switchProbe(probe, target));
    probe.queue = read.catch(() => undefined);
    return read;
  }

  /**
   * Which agents and effort levels exist depends on the model, so the probe
   * session is switched to it before its lists are read.
   */
  private async switchProbe(probe: Probe, target: string): Promise<ConfigOption[]> {
    const updated = sessionResultSchema.parse(
      await this.transport.request('session/set_config_option', {
        sessionId: probe.id,
        configId: 'model',
        value: target
      }, PROBE_TIMEOUT_MS)
    );
    const options = updated.configOptions ?? [];
    // Anything else is some other model's lists — the default's, or whatever
    // the probe was last switched to. Filing those under this model is how a
    // model with real levels ended up offering only "Default".
    if (findOption(options, 'model')?.currentValue !== target) {
      throw new Error(`OpenCode did not switch the probe session to "${target}"`);
    }
    return options;
  }

  /**
   * File a live session's option lists under the model they describe.
   *
   * Every session reports its own options with each change, so a model the
   * board has actually run is known without another probe round-trip — except
   * a list that may be OpenCode 2's early answer, which is never filed.
   */
  private learn(options: ConfigOption[]): void {
    const model = findOption(options, 'model')?.currentValue;
    // An early list filed here would be what every composer offers for a minute.
    if (!model || this.mayBeEarly(options)) return;
    this.learned.set(model, { options, fetchedAt: Date.now() });
  }

  private learnedOptions(modelId: string): ConfigOption[] | undefined {
    const hit = this.learned.get(modelId);
    return hit && Date.now() - hit.fetchedAt < CONFIG_CACHE_TTL_MS ? hit.options : undefined;
  }

  // --- making a session match the composer ---

  /**
   * `chosen` is the session's own pick. Without one the task's settings apply —
   * but a session that made a pick keeps it, so starting a fork on a different
   * model no longer re-models everything else the task is running.
   */
  async applyTo(
    task: BoardTask,
    sessionId: string,
    initialOptions: ConfigOption[],
    chosen?: SessionChoice
  ): Promise<void> {
    initialOptions = await this.realLists(sessionId, initialOptions);
    this.registry.setConfigOptions(sessionId, initialOptions);
    this.learn(initialOptions);
    const settings = sessionRunSettings(task, chosen);

    if (settings.model) await this.push(task, sessionId, 'model', settings.model, 'Model');
    if (settings.agent) await this.push(task, sessionId, 'mode', settings.agent, 'Agent');

    if (settings.thinkingLevel && settings.thinkingLevel !== 'default') {
      const target = settings.thinkingLevel === 'off' ? 'none' : settings.thinkingLevel;
      // An empty list means this model has no effort control at all — pushing
      // one would only produce a warning about a knob that does not exist.
      if (optionValues(this.optionsFor(sessionId), 'effort').length > 0) {
        await this.push(task, sessionId, 'effort', target, 'Thinking level');
      }
    }

    this.rememberAttribution(sessionId, this.optionsFor(sessionId), settings);
  }

  private optionsFor(sessionId: string): ConfigOption[] {
    return this.registry.configOptions(sessionId) ?? [];
  }

  private currentOf(sessionId: string, configId: string): string | undefined {
    return findOption(this.optionsFor(sessionId), configId)?.currentValue;
  }

  /**
   * Push one composer value onto the OpenCode session. Skips the round-trip
   * when it is already current. Never "gives up and uses the session default"
   * without trying — that is how a selected model failed to stick.
   */
  private async push(
    task: BoardTask,
    sessionId: string,
    configId: string,
    requested: string,
    label: string
  ): Promise<void> {
    const current = this.currentOf(sessionId, configId);
    let target = resolveConfigValue(this.optionsFor(sessionId), configId, requested);
    // OpenCode 2 answers a folder's first session before it has read the
    // folder's agent files, so a list without the value may just be early.
    if (!target && current) target = await this.reread(sessionId, configId, current, requested);
    if (current && current === target) return;

    if (!target) {
      const allowed = optionValues(this.optionsFor(sessionId), configId);
      this.warn(
        task.id,
        `${label} "${requested}" is not in OpenCode's list (${allowed.slice(0, 8).join(', ')}${allowed.length > 8 ? '…' : ''}). Trying it anyway.`
      );
    }

    const guesses = target ? [target] : configId === 'mode' ? agentIdGuesses(requested) : [requested];
    let applied: string | undefined;
    let error: string | undefined;
    for (const guess of guesses) {
      error = await this.setOption(sessionId, configId, guess);
      if (!error) {
        applied = guess;
        break;
      }
    }
    // OpenCode 2 can answer a switch with the lists from just before it — the
    // switch took, and its own update says so. Asking again settles which.
    // A session whose answers carry no lists has nothing to check against.
    const reported = findOption(this.optionsFor(sessionId), configId);
    if (applied && reported && reported.currentValue !== applied) {
      error = await this.setOption(sessionId, configId, applied);
      if (!error && this.currentOf(sessionId, configId) !== applied) {
        error = `OpenCode is still on ${this.currentOf(sessionId, configId) || 'its default'}`;
      }
      if (error) applied = undefined;
    }
    if (!applied) {
      this.warn(task.id, `Could not apply ${configId} "${requested}": ${error}`);
      this.warn(
        task.id,
        `Could not switch this session to ${label.toLowerCase()} "${requested}". It is still ${current || 'on the session default'}.`
      );
      return;
    }
    if (configId === 'model' && applied !== current) {
      this.emit(task.id, configInfo(`This turn is running as ${applied}.`));
    }
  }

  /**
   * Ask the session for its lists again — by re-setting `configId` to what it
   * already is, which changes nothing and answers with fresh options — until
   * they name `requested`. What it resolves to, or undefined if they never do.
   */
  private async reread(
    sessionId: string,
    configId: string,
    current: string,
    requested: string
  ): Promise<string | undefined> {
    for (const delayMs of REREAD_DELAYS_MS) {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (await this.setOption(sessionId, configId, current)) return undefined;
      const target = resolveConfigValue(this.optionsFor(sessionId), configId, requested);
      if (target) return target;
    }
    return undefined;
  }

  /**
   * Sends one `set_config_option` and records the options it answers with.
   * The error OpenCode gave, or undefined once it took.
   */
  private async setOption(sessionId: string, configId: string, value: string): Promise<string | undefined> {
    let res: unknown;
    try {
      res = await this.transport.request('session/set_config_option', { sessionId, configId, value });
    } catch (e) {
      return (e as Error).message;
    }
    const parsed = sessionResultSchema.safeParse(res);
    if (parsed.success && parsed.data.configOptions) {
      this.registry.setConfigOptions(sessionId, parsed.data.configOptions);
      this.learn(parsed.data.configOptions);
    }
    return res ? undefined : 'no answer';
  }

  /** What this session is actually running as, for stamping on its messages. */
  rememberAttribution(
    sessionId: string,
    options: ConfigOption[],
    fallback?: SessionChoice
  ): void {
    const find = (id: string) => findOption(options, id)?.currentValue;
    const effort = find('effort');
    const fallbackEffort = fallback?.thinkingLevel && fallback.thinkingLevel !== 'default'
      ? fallback.thinkingLevel
      : undefined;
    this.registry.setAttribution(sessionId, {
      model: find('model') || fallback?.model,
      agent: find('mode') || fallback?.agent,
      thinkingLevel: (effort && effort !== 'default' ? effort : undefined) || fallbackEffort
    });
  }

  private warn(taskId: string, text: string): void {
    console.warn(`[ACP] ${taskId}: ${text}`);
    this.emit(taskId, configWarning(text));
  }
}
