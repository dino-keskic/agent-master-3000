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
