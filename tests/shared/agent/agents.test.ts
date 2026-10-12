import test from 'node:test';
import assert from 'node:assert';
import { agentIdGuesses, agentMajorVersion, findAgentName, mayBeEarlyAgentList, pickDefaultAgent } from '../../../shared/agent/agents.js';

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

test('findAgentName', async (t) => {
  await t.test('finds a 1.x display name under the 2.x file name', () => {
    assert.strictEqual(findAgentName(['build', 'plan', 'ceo'], 'CEO'), 'ceo');
    assert.strictEqual(findAgentName(['build', 'CEO'], 'CEO'), 'CEO');
  });

  await t.test('is undefined for a name not listed, or none at all', () => {
    assert.strictEqual(findAgentName(['build'], 'CEO'), undefined);
    assert.strictEqual(findAgentName(['build'], undefined), undefined);
  });
});

test('agentIdGuesses', () => {
  assert.deepStrictEqual(agentIdGuesses('CEO'), ['CEO', 'ceo']);
  assert.deepStrictEqual(agentIdGuesses('ceo'), ['ceo']);
});

test('pickDefaultAgent keeps a 1.x pick under its 2.x name', () => {
  const v2 = [{ name: 'build', description: 'b' }, { name: 'plan', description: 'p' }, { name: 'ceo', description: 'c' }];
  assert.strictEqual(pickDefaultAgent(v2, 'CEO'), 'ceo');
});

test('mayBeEarlyAgentList', async (t) => {
  await t.test('the built-ins alone may be early before anything is trusted', () => {
    assert.strictEqual(mayBeEarlyAgentList(['build', 'plan'], undefined), true);
    assert.strictEqual(mayBeEarlyAgentList(['build'], undefined), true);
  });

  await t.test('the built-ins alone are early for a user known to have other agents', () => {
    assert.strictEqual(mayBeEarlyAgentList(['build', 'plan'], new Set(['ceo', 'acme-pr'])), true);
    assert.strictEqual(mayBeEarlyAgentList(['build', 'plan'], new Set(['build', 'plan', 'ceo'])), true);
  });

  await t.test('a user whose agents are the built-ins has nothing to wait for', () => {
    assert.strictEqual(mayBeEarlyAgentList(['build', 'plan'], new Set(['build', 'plan'])), false);
  });

  await t.test('a list naming anything else is the real one', () => {
    assert.strictEqual(mayBeEarlyAgentList(['build', 'plan', 'ceo'], undefined), false);
    assert.strictEqual(mayBeEarlyAgentList(['ceo'], new Set(['ceo'])), false);
  });

  await t.test('an empty list is no answer at all, not an early one', () => {
    assert.strictEqual(mayBeEarlyAgentList([], undefined), false);
  });
});

test('agentMajorVersion', () => {
  assert.strictEqual(agentMajorVersion({ protocolVersion: 1, agentInfo: { name: 'OpenCode', version: '2.0.24' } }), 2);
  assert.strictEqual(agentMajorVersion({ agentInfo: { version: '1.18.32' } }), 1);
  assert.strictEqual(agentMajorVersion({ agentInfo: { version: 'dev' } }), undefined);
  assert.strictEqual(agentMajorVersion({ protocolVersion: 1 }), undefined);
  assert.strictEqual(agentMajorVersion(null), undefined);
});
