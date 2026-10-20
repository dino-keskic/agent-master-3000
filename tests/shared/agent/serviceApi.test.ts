import test from 'node:test';
import assert from 'node:assert';
import {
  activeSessionIds,
  applyConfigValue,
  parseModelValue,
  parseServiceFile,
  permissionRules,
  promptInput,
  reconnectDelay,
  serviceAuthHeader,
  sessionListResult,
  splitSseFrames,
  synthesizeConfigOptions
} from '../../../shared/agent/serviceApi.js';

test('parseServiceFile', () => {
  assert.deepStrictEqual(
    parseServiceFile('{"id":"x","version":"2.0.24","url":"http://127.0.0.1:49374/","pid":371,"password":"pw"}'),
    { url: 'http://127.0.0.1:49374', password: 'pw', pid: 371, version: '2.0.24', id: 'x' }
  );
  assert.strictEqual(parseServiceFile('not json'), undefined);
  assert.strictEqual(parseServiceFile('{"url":"http://x"}'), undefined);
  assert.strictEqual(parseServiceFile('{"url":"file:///x","password":"p"}'), undefined);
  assert.strictEqual(parseServiceFile('null'), undefined);
});

test('serviceAuthHeader is basic auth as user opencode', () => {
  assert.strictEqual(serviceAuthHeader('pw'), `Basic ${Buffer.from('opencode:pw').toString('base64')}`);
});

test('permissionRules denies each switched-off tool and nothing else', () => {
  assert.deepStrictEqual(permissionRules({ webfetch: false, shell: true, edit: false }), [
    { action: 'edit', resource: '*', effect: 'deny' },
    { action: 'webfetch', resource: '*', effect: 'deny' }
  ]);
  assert.deepStrictEqual(permissionRules({}), []);
});

test('parseModelValue keeps slashes in the model id', () => {
  assert.deepStrictEqual(parseModelValue('openrouter/moonshot/kimi'), { providerID: 'openrouter', id: 'moonshot/kimi' });
  assert.strictEqual(parseModelValue('bare'), undefined);
  assert.strictEqual(parseModelValue('p/'), undefined);
});

test('synthesizeConfigOptions', async (t) => {
  const models = [
    { id: 'gpt', modelID: 'gpt', providerID: 'oa', name: 'GPT', enabled: true, variants: [{ id: 'high' }, { id: 'low' }] },
    { id: 'off', providerID: 'oa', enabled: false },
    { id: 'stub', providerID: 'local', name: 'Stub', variants: [] }
  ];
  const agents = [
    { id: 'build', name: 'Build', mode: 'primary' },
    { id: 'explore', mode: 'subagent' },
    { id: 'secret', mode: 'primary', hidden: true },
    { id: 'mine', mode: 'all', description: 'My agent' }
  ];

  await t.test('lists enabled models, pickable agents and the model\'s variants', () => {
    const [model, mode, effort] = synthesizeConfigOptions(models, agents, {
      model: { providerID: 'oa', id: 'gpt', variant: 'high' },
      agent: 'build'
    });
    assert.deepStrictEqual(model, {
      id: 'model',
      currentValue: 'oa/gpt',
      options: [{ value: 'oa/gpt', name: 'GPT' }, { value: 'local/stub', name: 'Stub' }]
    });
    assert.deepStrictEqual(mode!.options!.map((o) => o.value), ['build', 'mine']);
    assert.strictEqual(mode!.currentValue, 'build');
    assert.deepStrictEqual(effort, {
      id: 'effort',
      currentValue: 'high',
      options: [{ value: 'default', name: 'Default' }, { value: 'high', name: 'high' }, { value: 'low', name: 'low' }]
    });
  });

  await t.test('a model without variants has no effort control', () => {
    const effort = synthesizeConfigOptions(models, agents, { model: { providerID: 'local', id: 'stub' } })[2]!;
    assert.deepStrictEqual(effort.options, []);
    assert.strictEqual(effort.currentValue, 'default');
  });
});

test('applyConfigValue', () => {
  const state = { model: { providerID: 'oa', id: 'gpt', variant: 'high' }, agent: 'build' };
  assert.deepStrictEqual(applyConfigValue(state, 'model', 'local/stub'), { model: { providerID: 'local', id: 'stub' }, agent: 'build' });
  assert.deepStrictEqual(applyConfigValue(state, 'effort', 'low')!.model, { providerID: 'oa', id: 'gpt', variant: 'low' });
  assert.deepStrictEqual(applyConfigValue(state, 'effort', 'default')!.model, { providerID: 'oa', id: 'gpt' });
  assert.deepStrictEqual(applyConfigValue(state, 'mode', 'plan')!.agent, 'plan');
  assert.strictEqual(applyConfigValue({}, 'effort', 'low'), undefined);
  assert.strictEqual(applyConfigValue(state, 'model', 'bare'), undefined);
  assert.strictEqual(applyConfigValue(state, 'other', 'x'), undefined);
});

test('promptInput joins text and turns images into data URIs', () => {
  assert.deepStrictEqual(promptInput([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]), { text: 'a\n\nb' });
  assert.deepStrictEqual(promptInput([{ type: 'text', text: 'see' }, { type: 'image', data: 'AAA', mimeType: 'image/jpeg' }]), {
    text: 'see',
    files: [{ uri: 'data:image/jpeg;base64,AAA' }]
  });
  assert.deepStrictEqual(promptInput(undefined), { text: '' });
});

test('sessionListResult lists live root sessions, optionally in one folder', () => {
  const sessions = [
    { id: 'ses_a', title: 'A', location: { directory: '/w' }, time: { updated: 0 }, agent: 'build' },
    { id: 'ses_b', parentID: 'ses_a', location: { directory: '/w' } },
    { id: 'ses_c', location: { directory: '/other' }, time: { updated: 1000 } },
    { id: 'ses_d', location: { directory: '/w' }, time: { archived: 5 } }
  ];
  assert.deepStrictEqual(sessionListResult(sessions).sessions.map((s) => s.sessionId), ['ses_a', 'ses_c']);
  assert.deepStrictEqual(sessionListResult(sessions, '/w').sessions, [
    { sessionId: 'ses_a', title: 'A', cwd: '/w', updatedAt: undefined, agent: 'build' }
  ]);
  assert.strictEqual(sessionListResult(sessions, '/other').sessions[0]!.updatedAt, new Date(1000).toISOString());
});

test('activeSessionIds', () => {
  assert.deepStrictEqual(activeSessionIds({ data: { ses_1: { type: 'running' }, ses_2: { type: 'idle' }, junk: {} } }), ['ses_1']);
  assert.deepStrictEqual(activeSessionIds(null), []);
});

test('reconnectDelay doubles to a ceiling', () => {
  assert.deepStrictEqual([1, 2, 3, 10].map(reconnectDelay), [500, 1000, 2000, 15_000]);
});

test('splitSseFrames', () => {
  const { frames, rest } = splitSseFrames('data: {"a":1}\n\n: heartbeat\n\nevent: x\r\ndata: {"b":\r\ndata: 2}\r\n\r\ndata: {"c"');
  assert.deepStrictEqual(frames, ['{"a":1}', '{"b":\n2}']);
  assert.strictEqual(rest, 'data: {"c"');
});
