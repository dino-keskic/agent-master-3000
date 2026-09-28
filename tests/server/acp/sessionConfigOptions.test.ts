import test from 'node:test';
import assert from 'node:assert';
import { describeConfigOptions, emptyConfigOptions } from '../../../server/acp/sessionConfig.js';

const OPTIONS = [
  {
    id: 'model',
    currentValue: 'anthropic/claude-opus-5',
    options: [
      { value: 'anthropic/claude-opus-5', name: 'Claude Opus 5' },
      { value: 'openai/gpt-luna' }
    ]
  },
  {
    id: 'mode',
    currentValue: 'Local',
    options: [
      { value: 'Local', name: 'Local', description: 'writes files' },
      { value: 'plan', name: 'Plan' },
      { value: 'bare' }
    ]
  },
  {
    id: 'effort',
    currentValue: 'medium',
    options: [{ value: 'low', name: 'Low' }, { value: 'medium' }]
  }
];

test('describeConfigOptions', async (t) => {
  await t.test('reads the three dropdowns out of one options array', () => {
    const described = describeConfigOptions(OPTIONS);
    assert.deepStrictEqual(described.models, [
      { id: 'anthropic/claude-opus-5', name: 'Claude Opus 5', provider: 'anthropic' },
      { id: 'openai/gpt-luna', name: 'openai/gpt-luna', provider: 'openai' }
    ]);
    assert.deepStrictEqual(described.effortLevels, [
      { value: 'low', name: 'Low' },
      { value: 'medium', name: 'medium' }
    ]);
    assert.deepStrictEqual(described.current, {
      model: 'anthropic/claude-opus-5',
      agent: 'Local',
      effortLevel: 'medium'
    });
  });

  await t.test('describes agents by description, then name, then id', () => {
    assert.deepStrictEqual(describeConfigOptions(OPTIONS).agents, [
      { name: 'Local', description: 'writes files' },
      { name: 'plan', description: 'Plan' },
      { name: 'bare', description: 'bare' }
    ]);
  });

  await t.test('an unprefixed model id still gets a provider', () => {
    const [model] = describeConfigOptions([{ id: 'model', options: [{ value: 'local-llm' }] }]).models;
    assert.deepStrictEqual(model, { id: 'local-llm', name: 'local-llm', provider: 'local-llm' });
  });

  await t.test('missing options mean empty lists, not a throw', () => {
    const described = describeConfigOptions([]);
    assert.deepStrictEqual(described.models, []);
    assert.deepStrictEqual(described.agents, []);
    assert.deepStrictEqual(described.effortLevels, []);
    assert.strictEqual(described.current.model, undefined);
    assert.deepStrictEqual(describeConfigOptions([{ id: 'model' }]).models, []);
  });

  await t.test('emptyConfigOptions hands out a fresh object each time', () => {
    const first = emptyConfigOptions();
    first.models.push({ id: 'x', name: 'x', provider: 'x' });
    assert.deepStrictEqual(emptyConfigOptions().models, []);
  });
});
