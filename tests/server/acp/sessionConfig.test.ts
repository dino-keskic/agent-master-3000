import test from 'node:test';
import assert from 'node:assert';
import { SessionConfigurator } from '../../../server/acp/sessionConfig.js';
import { AcpSessionRegistry } from '../../../server/acp/sessionRegistry.js';
import { AcpTransport } from '../../../server/acp/transport.js';
import { BoardTask } from '../../../shared/types.js';

const MODELS = {
  id: 'model',
  options: [{ value: 'opencode/big-pickle' }, { value: 'opencode/muse-spark' }, { value: 'opencode/ling-flash' }]
};

/** Levels per model, the way `opencode acp` answers a model switch. */
const LEVELS: Record<string, string[]> = {
  'opencode/big-pickle': [],
  'opencode/muse-spark': ['minimal', 'low', 'medium', 'high', 'xhigh'],
  'opencode/ling-flash': ['low', 'medium', 'high']
};

function optionsFor(model: string) {
  const levels = LEVELS[model] ?? [];
  return [
    { ...MODELS, currentValue: model },
    ...(levels.length ? [{ id: 'effort', currentValue: levels[0], options: levels.map((value) => ({ value })) }] : [])
  ];
}

function fakeTransport(opts: { refuse?: string; delayMs?: (model: string) => number } = {}) {
  const calls: string[] = [];
  let current = 'opencode/big-pickle';
  const transport = {
    agentMajor: () => 2,
    answersEarly: () => true,
    async request(method: string, params: { value?: string }) {
      const value = params.value ?? '';
      calls.push(method === 'session/set_config_option' ? `${method}:${value}` : method);
      if (method === 'session/new') return { sessionId: 'probe', configOptions: optionsFor(current) };
      if (method === 'session/set_config_option') {
        await new Promise((r) => setTimeout(r, opts.delayMs?.(value) ?? 0));
        // OpenCode keeps the old model when it cannot switch.
        if (value !== opts.refuse) current = value;
        return { configOptions: optionsFor(current) };
      }
      throw new Error(`unexpected ${method}`);
    }
  };
  return { transport: transport as unknown as AcpTransport, calls };
}

function levelsOf(result: { effortLevels: { value: string }[] }) {
  return result.effortLevels.map((e) => e.value);
}

test('SessionConfigurator.fetchOptions', async (t) => {
  await t.test('reads a model\'s levels while another session is mid-turn', async () => {
    const registry = new AcpSessionRegistry();
    registry.markInFlight('ses-running');
    const { transport } = fakeTransport();
    const config = new SessionConfigurator(transport, registry, () => {});

    assert.deepStrictEqual(levelsOf(await config.fetchOptions('opencode/muse-spark')), LEVELS['opencode/muse-spark']);
  });

  await t.test('matches an unprefixed model id to the one OpenCode lists', async () => {
    const { transport, calls } = fakeTransport();
    const config = new SessionConfigurator(transport, new AcpSessionRegistry(), () => {});

    assert.deepStrictEqual(levelsOf(await config.fetchOptions('ling-flash')), LEVELS['opencode/ling-flash']);
    assert.ok(calls.includes('session/set_config_option:opencode/ling-flash'));
  });

  await t.test('a switch that did not happen is not another model\'s answer', async () => {
    const { transport } = fakeTransport({ refuse: 'opencode/muse-spark' });
    const config = new SessionConfigurator(transport, new AcpSessionRegistry(), () => {});

    const result = await config.fetchOptions('opencode/muse-spark');
    assert.deepStrictEqual(result.models, [], 'unanswered, so the board asks again');
    assert.deepStrictEqual(levelsOf(result), []);
  });

  await t.test('concurrent reads for different models each get their own levels', async () => {
    // The first switch is slow: interleaved, its read would see the second model.
    const { transport } = fakeTransport({ delayMs: (m) => (m === 'opencode/muse-spark' ? 30 : 0) });
    const config = new SessionConfigurator(transport, new AcpSessionRegistry(), () => {});

    const [muse, ling] = await Promise.all([
      config.fetchOptions('opencode/muse-spark'),
      config.fetchOptions('opencode/ling-flash')
    ]);
    assert.deepStrictEqual(levelsOf(muse), LEVELS['opencode/muse-spark']);
    assert.deepStrictEqual(levelsOf(ling), LEVELS['opencode/ling-flash']);
  });

  await t.test('an unknown model is an error, not the default model\'s lists', async () => {
    const { transport } = fakeTransport();
    const config = new SessionConfigurator(transport, new AcpSessionRegistry(), () => {});

    assert.deepStrictEqual((await config.fetchOptions('nope/unknown')).models, []);
  });
});

/** A transport where each folder has the shared models plus its own. */
function folderTransport(extra: Record<string, string[]>, failIn: string[] = []) {
  const calls: string[] = [];
  let next = 0;
  const sessions = new Map<string, string>();
  const listFor = (cwd: string, current: string) => [{
    id: 'model',
    currentValue: current,
    options: [...MODELS.options, ...(extra[cwd] ?? []).map((value) => ({ value }))]
  }];
  const transport = {
    agentMajor: () => 2,
    answersEarly: () => true,
    async request(method: string, params: { cwd?: string; sessionId?: string; value?: string }) {
      if (method === 'session/new') {
        calls.push(`new:${params.cwd}`);
        if (failIn.includes(params.cwd!)) throw new Error('boom');
        const id = `probe-${next++}`;
        sessions.set(id, params.cwd!);
        return { sessionId: id, configOptions: listFor(params.cwd!, 'opencode/big-pickle') };
      }
      if (method === 'session/set_config_option') {
        const cwd = sessions.get(params.sessionId!)!;
        calls.push(`set:${cwd}:${params.value}`);
        return { configOptions: listFor(cwd, params.value!) };
      }
      throw new Error(`unexpected ${method}`);
    }
  };
  return { transport: transport as unknown as AcpTransport, calls };
}

test('SessionConfigurator.fetchOptions across project folders', async (t) => {
  await t.test("lists a project's own models, marked with the project", async () => {
    const { transport } = folderTransport({ '/p/api': ['local/qwen'] });
    const config = new SessionConfigurator(transport, new AcpSessionRegistry(), () => {});

    const { models } = await config.fetchOptions(undefined, ['/p/api', '/p/web']);
    assert.deepStrictEqual(models.map((m) => [m.id, m.onlyIn]), [
      ['opencode/big-pickle', undefined],
      ['opencode/muse-spark', undefined],
      ['opencode/ling-flash', undefined],
      ['local/qwen', ['/p/api']]
    ]);
  });

  await t.test('reads a project-only model in the project that has it', async () => {
    const { transport, calls } = folderTransport({ '/p/web': ['local/qwen'] });
    const config = new SessionConfigurator(transport, new AcpSessionRegistry(), () => {});

    const result = await config.fetchOptions('local/qwen', ['/p/api', '/p/web']);
    assert.strictEqual(result.current.model, 'local/qwen');
    assert.ok(calls.includes('set:/p/web:local/qwen'));
    assert.ok(result.models.some((m) => m.id === 'opencode/muse-spark'), 'the dropdown still lists everything');
  });

  await t.test('a folder that cannot be opened does not hide the others', async () => {
    const { transport } = folderTransport({ '/p/web': ['local/qwen'] }, ['/p/gone']);
    const config = new SessionConfigurator(transport, new AcpSessionRegistry(), () => {});

    const { models } = await config.fetchOptions(undefined, ['/p/gone', '/p/web']);
    assert.ok(models.some((m) => m.id === 'local/qwen' && !m.onlyIn));
  });

  await t.test('opens one probe per folder, once', async () => {
    const { transport, calls } = folderTransport({});
    const config = new SessionConfigurator(transport, new AcpSessionRegistry(), () => {});

    await config.fetchOptions(undefined, ['/p/api', '/p/web']);
    await config.fetchOptions('opencode/muse-spark', ['/p/api', '/p/web']);
    assert.deepStrictEqual(calls.filter((c) => c.startsWith('new:')), ['new:/p/api', 'new:/p/web']);
  });
});

const TASK = { id: 'TASK-1', model: 'opencode/big-pickle' } as BoardTask;

test('SessionConfigurator.applyTo', async (t) => {
  await t.test('runs a session as its own pick, not the task\'s model', async () => {
    const { transport, calls } = fakeTransport();
    const config = new SessionConfigurator(transport, new AcpSessionRegistry(), () => {});

    await config.applyTo(TASK, 'ses-fork', optionsFor('opencode/big-pickle'), { model: 'opencode/muse-spark' });

    assert.ok(calls.includes('session/set_config_option:opencode/muse-spark'), 'the fork gets the model it asked for');
    assert.ok(!calls.includes('session/set_config_option:opencode/big-pickle'), "and the task's model is not pushed over it");
  });

  await t.test('a session with no pick of its own runs as the task', async () => {
    const { transport, calls } = fakeTransport();
    const config = new SessionConfigurator(transport, new AcpSessionRegistry(), () => {});

    // The session is on another model; the task's settings bring it back.
    await config.applyTo(TASK, 'ses-main', optionsFor('opencode/ling-flash'));
    assert.ok(calls.includes('session/set_config_option:opencode/big-pickle'));
  });
});

/** OpenCode 2's early answer for a folder whose config it has not read yet. */
const cold = () => [
  { ...MODELS, currentValue: 'opencode/big-pickle' },
  { id: 'mode', currentValue: 'build', options: [{ value: 'build' }, { value: 'plan' }] }
];

/** The same session's lists once the folder's agents are read. */
const warmWith = (agents: string[]) => [
  { ...MODELS, currentValue: 'opencode/big-pickle' },
  { id: 'mode', currentValue: 'build', options: agents.map((value) => ({ value })) }
];

/**
 * OpenCode 2 on a folder's first session: `build` and `plan` only, then the
 * folder's own agents from the next request on. `known` is what exists.
 *
 * `push` is how it says so on its own: the real lists pushed for the session
 * `pushAfterMs` after the answer, or — `pushFirst` — handled before the answer
 * is, as when both arrive in one read from the pipe. Pushes go to `listener`.
 */
function coldAgentTransport(
  known: string[],
  opts: { staleSwitch?: boolean; staysCold?: boolean; major?: number; pushAfterMs?: number; pushFirst?: boolean } = {}
) {
  const calls: string[] = [];
  const failures: string[] = [];
  let warm = false;
  let staleOnce = !!opts.staleSwitch;
  let mode = 'build';
  const fake = { listener: undefined as ((sessionId: string, options: ReturnType<typeof warmWith>) => void) | undefined };
  const options = () => [
    { ...MODELS, currentValue: 'opencode/big-pickle' },
    { id: 'mode', currentValue: mode, options: (warm ? known : ['build', 'plan']).map((value) => ({ value })) }
  ];
  const transport = {
    agentMajor: () => opts.major ?? 2,
    answersEarly: () => (opts.major ?? 2) >= 2,
    request(method: string, params: { configId?: string; value?: string }) {
      calls.push(method === 'session/set_config_option' ? `${params.configId}:${params.value}` : method);
      if (method === 'session/new') {
        const first = options();
        warm = !opts.staysCold;
        const reply = Promise.resolve({ sessionId: 'probe', configOptions: first });
        if (opts.pushFirst) fake.listener?.('probe', warmWith(known));
        else if (opts.pushAfterMs !== undefined) setTimeout(() => fake.listener?.('probe', warmWith(known)), opts.pushAfterMs);
        return reply;
      }
      if (method === 'session/set_config_option') {
        warm = !opts.staysCold;
        const value = params.value ?? '';
        if (params.configId === 'mode') {
          if (!known.includes(value)) {
            failures.push(value);
            return Promise.reject(new Error(`Invalid params: mode not found: ${value}`));
          }
          // The switch takes, but the answer is the lists from just before it.
          const before = options();
          mode = value;
          if (staleOnce && value !== 'build') {
            staleOnce = false;
            return Promise.resolve({ configOptions: before });
          }
        }
        return Promise.resolve({ configOptions: options() });
      }
      return Promise.reject(new Error(`unexpected ${method}`));
    }
  };
  return { transport: transport as unknown as AcpTransport, calls, failures, fake };
}

/** A configurator on `transport` that hears its pushes; `waitMs` short where none will come. */
function configOn(
  setup: ReturnType<typeof coldAgentTransport>,
  opts: { registry?: AcpSessionRegistry; emit?: (taskId: string, event: unknown) => void; onListsChanged?: () => void; waitMs?: number } = {}
) {
  const config = new SessionConfigurator(
    setup.transport,
    opts.registry ?? new AcpSessionRegistry(),
    opts.emit ?? (() => {}),
    opts.onListsChanged,
    opts.waitMs
  );
  setup.fake.listener = (sessionId, options) => config.onPushed(sessionId, options);
  return config;
}

const namesOf = (result: { agents: { name: string }[] }) => result.agents.map((a) => a.name);

test('SessionConfigurator and a list read too early', async (t) => {
  const AGENTS = ['build', 'plan', 'ceo', 'acme-pr'];
  const ceoTask: BoardTask = { ...TASK, agent: 'CEO' };

  await t.test("a probe's lists are the ones OpenCode pushes after its early answer", async () => {
    const setup = coldAgentTransport(AGENTS, { staysCold: true, pushAfterMs: 20 });
    const config = configOn(setup);

    assert.deepStrictEqual(namesOf(await config.fetchOptions()), AGENTS);
  });

  await t.test('a push handled before the answer it follows still counts', async () => {
    const setup = coldAgentTransport(AGENTS, { staysCold: true, pushFirst: true });
    const config = configOn(setup, { waitMs: 60_000 });

    assert.deepStrictEqual(namesOf(await config.fetchOptions()), AGENTS);
  });

  await t.test('a task session waits for its pushed lists, then switches straight to the agent', async () => {
    const setup = coldAgentTransport(AGENTS);
    const registry = new AcpSessionRegistry();
    const warnings: unknown[] = [];
    const config = configOn(setup, { registry, emit: (_id, e) => warnings.push(e) });

    setTimeout(() => config.onPushed('ses-1', warmWith(AGENTS)), 20);
    await config.applyTo(ceoTask, 'ses-1', cold());

    assert.deepStrictEqual(setup.calls, ['mode:ceo']);
    assert.strictEqual(registry.configOptions('ses-1')?.find((o) => o.id === 'mode')?.currentValue, 'ceo');
    assert.deepStrictEqual(warnings, []);
  });

  await t.test('a push for a session the board has not claimed yet waits for it', async () => {
    const setup = coldAgentTransport(AGENTS);
    const config = configOn(setup, { waitMs: 60_000 });

    config.onPushed('ses-1', warmWith(AGENTS));
    await config.applyTo(ceoTask, 'ses-1', cold());

    assert.deepStrictEqual(setup.calls, ['mode:ceo']);
  });

  await t.test('without a push, asks again before calling an agent missing, and sends its 2.x name', async () => {
    const setup = coldAgentTransport(AGENTS);
    const warnings: unknown[] = [];
    const config = configOn(setup, { emit: (_id, e) => warnings.push(e), waitMs: 10 });

    await config.applyTo(ceoTask, 'ses-1', cold());

    assert.deepStrictEqual(setup.calls, ['mode:build', 'mode:ceo'], 're-read once, then switched');
    assert.deepStrictEqual(setup.failures, []);
    assert.deepStrictEqual(warnings, []);
  });

  await t.test('an agent that really is missing is still tried, as written and lower-cased', async () => {
    const setup = coldAgentTransport(['build', 'plan']);
    const warnings: string[] = [];
    const config = configOn(setup, { emit: (_id, e) => warnings.push(JSON.stringify(e)), waitMs: 10 });

    await config.applyTo(ceoTask, 'ses-1', cold());

    assert.deepStrictEqual(setup.failures, ['CEO', 'ceo']);
    assert.ok(warnings.some((w) => w.includes('not in OpenCode')));
    assert.ok(warnings.some((w) => w.includes('It is still build')));
  });

  await t.test('a switch answered with the lists from before it is asked about again', async () => {
    const setup = coldAgentTransport(AGENTS, { staleSwitch: true });
    const registry = new AcpSessionRegistry();
    const warnings: unknown[] = [];
    const config = configOn(setup, { registry, emit: (_id, e) => warnings.push(e), waitMs: 10 });

    await config.applyTo(ceoTask, 'ses-1', cold());

    assert.deepStrictEqual(setup.calls, ['mode:build', 'mode:ceo', 'mode:ceo']);
    assert.strictEqual(registry.configOptions('ses-1')?.find((o) => o.id === 'mode')?.currentValue, 'ceo');
    assert.deepStrictEqual(warnings, []);
  });

  await t.test('lists pushed after the probe gave up reach it, and the board is told', async () => {
    const setup = coldAgentTransport(AGENTS, { staysCold: true });
    let changed = 0;
    const config = configOn(setup, { waitMs: 10, onListsChanged: () => changed++ });

    assert.deepStrictEqual(namesOf(await config.fetchOptions()), ['build', 'plan']);
    config.onPushed('probe', warmWith(AGENTS));
    assert.deepStrictEqual(namesOf(await config.fetchOptions()), AGENTS);
    assert.strictEqual(changed, 1);
  });

  await t.test('an early list is never filed as what a model offers', async () => {
    const setup = coldAgentTransport(AGENTS, { pushAfterMs: 5 });
    const config = configOn(setup, { waitMs: 10 });

    await config.fetchOptions();
    // A task session in another folder, answered early and never pushed to.
    await config.applyTo(TASK, 'ses-1', cold());
    assert.deepStrictEqual(namesOf(await config.fetchOptions('opencode/big-pickle')), AGENTS);
  });

  await t.test('OpenCode 1.x never answers early, so nothing waits', async () => {
    const setup = coldAgentTransport(['build', 'plan'], { major: 1, staysCold: true });
    const config = configOn(setup, { waitMs: 60_000 });

    const started = Date.now();
    assert.deepStrictEqual(namesOf(await config.fetchOptions()), ['build', 'plan']);
    assert.ok(Date.now() - started < 1000);
  });

  await t.test('a user whose only agents are the built-ins waits once, not every time', async () => {
    const setup = coldAgentTransport(['build', 'plan'], { staysCold: true });
    const config = configOn(setup, { waitMs: 30 });

    await config.fetchOptions();
    const started = Date.now();
    await config.applyTo(TASK, 'ses-1', cold());
    assert.ok(Date.now() - started < 30, 'build and plan are now known to be all there is');
  });
});
