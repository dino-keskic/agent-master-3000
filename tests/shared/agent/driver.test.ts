import test from 'node:test';
import assert from 'node:assert';
import { chooseDriver, majorOf } from '../../../shared/agent/driver.js';

test('chooseDriver', async (t) => {
  await t.test('OpenCode 2 gets the service', () => {
    assert.strictEqual(chooseDriver({ major: 2 }), 'service');
    assert.strictEqual(chooseDriver({ major: 3, configured: 'service' }), 'service');
  });

  await t.test('1.x, or an OpenCode that will not say, keeps the child', () => {
    assert.strictEqual(chooseDriver({ major: 1 }), 'acp');
    assert.strictEqual(chooseDriver({}), 'acp');
  });

  await t.test('the setting forces the child', () => {
    assert.strictEqual(chooseDriver({ major: 2, configured: 'acp' }), 'acp');
  });

  await t.test('a stand-in agent is spoken to over ACP', () => {
    assert.strictEqual(chooseDriver({ major: 2, acpCommand: 'node fake-agent.mjs' }), 'acp');
    assert.strictEqual(chooseDriver({ major: 2, acpCommand: '  ' }), 'service');
  });
});

test('majorOf', () => {
  assert.strictEqual(majorOf('2.0.24'), 2);
  assert.strictEqual(majorOf('1.18.3-beta.1'), 1);
  assert.strictEqual(majorOf(undefined), undefined);
  assert.strictEqual(majorOf('dev'), undefined);
});
