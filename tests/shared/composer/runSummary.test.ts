import test from 'node:test';
import assert from 'node:assert';
import { runSummary } from '../../../shared/composer/runSummary.js';

/** The composer's one line about how a turn will run. */

test('names the model, agent, effort and permission mode', () => {
  assert.strictEqual(
    runSummary({ model: 'anthropic/opus-5.5', agent: 'build', thinkingLevel: 'medium', permissionMode: 'review-writes' }),
    'opus-5.5 · build · medium · review writes'
  );
});

test('leaves out a default effort and prefers the catalog name', () => {
  assert.strictEqual(
    runSummary({ model: 'x/y', modelName: 'Opus 5.5', agent: '', thinkingLevel: 'default', permissionMode: 'auto' }),
    'Opus 5.5 · auto-approve'
  );
});

test('says so when no model is chosen yet', () => {
  assert.strictEqual(
    runSummary({ model: '', agent: 'plan', thinkingLevel: 'default', permissionMode: 'manual' }),
    'default model · plan · ask every time'
  );
});
