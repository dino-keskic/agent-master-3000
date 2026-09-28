import { OpenCodeAgent, OpenCodeModel } from '../../shared/sessions/types.js';
import { BoardTask, SessionChoice } from '../../shared/types.js';
import { sessionRunSettings } from '../../shared/task/sessions.js';
import { mergeFolderModels } from '../../shared/agent/modelScope.js';
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

  constructor(
    private readonly transport: AcpTransport,
    private readonly registry: AcpSessionRegistry,
    private readonly emit: (taskId: string, event: AcpEvent) => void
  ) {}

  /** The agent process is gone; its probe sessions and cached lists went with it. */
  reset(): void {
    this.probes.clear();
    this.cache.clear();
    this.learned.clear();
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
        .then((raw) => {
          const created = sessionResultSchema.parse(raw);
          if (!created.sessionId) throw new Error('OpenCode did not open a session');
          return { id: created.sessionId, baseOptions: created.configOptions ?? [], queue: Promise.resolve() };
        });
      // A failed open is not remembered: the next read tries again.
      probe.catch(() => this.probes.delete(folder));
      this.probes.set(folder, probe);
    }
    return probe;
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
   * board has actually run is known without another probe round-trip.
   */
  private learn(options: ConfigOption[]): void {
    const model = findOption(options, 'model')?.currentValue;
    if (!model) return;
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
    const options = this.optionsFor(sessionId);
    const current = findOption(options, configId)?.currentValue;
    const resolved = resolveConfigValue(options, configId, requested) || requested;
    if (current && current === resolved) return;

    const allowed = optionValues(options, configId);
    if (allowed.length > 0 && !allowed.includes(resolved)) {
      this.warn(
        task.id,
        `${label} "${requested}" is not in OpenCode's list (${allowed.slice(0, 8).join(', ')}${allowed.length > 8 ? '…' : ''}). Trying it anyway.`
      );
    }

    if (!(await this.setOption(task.id, sessionId, configId, resolved))) {
      this.warn(
        task.id,
        `Could not switch this session to ${label.toLowerCase()} "${requested}". It is still ${current || 'on the session default'}.`
      );
      return;
    }
    if (configId === 'model' && resolved !== current) {
      this.emit(task.id, configInfo(`This turn is running as ${resolved}.`));
    }
  }

  /** Sends one `set_config_option` and records the options it answers with. */
  private async setOption(taskId: string, sessionId: string, configId: string, value: string): Promise<boolean> {
    const res = await this.transport
      .request('session/set_config_option', { sessionId, configId, value })
      .catch((e: Error) => {
        this.warn(taskId, `Could not apply ${configId} "${value}": ${e.message}`);
        return null;
      });
    const parsed = sessionResultSchema.safeParse(res);
    if (parsed.success && parsed.data.configOptions) {
      this.registry.setConfigOptions(sessionId, parsed.data.configOptions);
      this.learn(parsed.data.configOptions);
    }
    return !!res;
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
