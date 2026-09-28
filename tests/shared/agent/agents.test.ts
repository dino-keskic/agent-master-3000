import test from 'node:test';
import assert from 'node:assert';
import { pickDefaultAgent } from '../../../shared/agent/agents.js';

const agents = [
  { name: 'Ask Agent', description: 'research' },
  { name: 'Local', description: 'writes files' },
  { name: 'plan', description: 'plans' }
];

test('pickDefaultAgent', async (t) => {
  await t.test('keeps a usable current pick', () => {
    assert.strictEqual(pickDefaultAgent(agents, 'plan'), 'plan');
    assert.strictEqual(pickDefaultAgent(agents, 'Local'), 'Local');
  });

  await t.test('replaces a current pick the agent no longer offers', () => {
    assert.strictEqual(pickDefaultAgent(agents, 'coder'), 'Local');
  });

  await t.test('never defaults to a research-only agent', () => {
    assert.strictEqual(pickDefaultAgent(agents, 'Ask Agent'), 'Local');
    assert.strictEqual(
      pickDefaultAgent([...agents, { name: 'acme-code-reviewer', description: 'review' }], 'coder'),
      'Local'
    );
    // Even when the only research-only agent is the current one and nothing
    // preferred exists, a writing agent wins.
    assert.strictEqual(
      pickDefaultAgent([{ name: 'Ask', description: 'r' }, { name: 'zeta', description: 'w' }], 'Ask'),
      'zeta'
    );
  });

  await t.test('falls back rather than returning nothing', () => {
    // Only research-only agents exist: keep the current one...
    assert.strictEqual(pickDefaultAgent([{ name: 'Ask', description: 'r' }], 'Ask'), 'Ask');
    // ...or take the first on offer.
    assert.strictEqual(pickDefaultAgent([{ name: 'Ask', description: 'r' }], 'gone'), 'Ask');
    assert.strictEqual(pickDefaultAgent([], 'coder'), '');
  });
});
