import test from 'node:test';
import assert from 'node:assert';
import { mergeFolderModels, modelOfferedIn, modelOptionLabel, modelScopeLabel, withModelScopes } from '../../../shared/agent/modelScope.js';

const m = (id: string) => ({ id, name: id, provider: id.split('/')[0]! });

test('mergeFolderModels', async (t) => {
  await t.test('a model every folder has carries no scope', () => {
    const merged = mergeFolderModels([
      { folder: '/p/api', models: [m('opencode/a')] },
      { folder: '/p/web', models: [m('opencode/a')] }
    ]);
    assert.deepStrictEqual(merged, [m('opencode/a')]);
  });

  await t.test("a project's own provider is offered, marked with where", () => {
    const merged = mergeFolderModels([
      { folder: '/p/api', models: [m('opencode/a'), m('local/qwen')] },
      { folder: '/p/web', models: [m('opencode/a')] }
    ]);
    assert.deepStrictEqual(merged.map((x) => [x.id, x.onlyIn]), [
      ['opencode/a', undefined],
      ['local/qwen', ['/p/api']]
    ]);
  });

  await t.test('first-seen order, across folders', () => {
    const merged = mergeFolderModels([
      { folder: '/a', models: [m('x/1'), m('x/2')] },
      { folder: '/b', models: [m('x/3'), m('x/1'), m('x/2')] }
    ]);
    assert.deepStrictEqual(merged.map((x) => x.id), ['x/1', 'x/2', 'x/3']);
  });

  await t.test('one folder: nothing is scoped', () => {
    assert.deepStrictEqual(mergeFolderModels([{ folder: '/a', models: [m('x/1')] }]), [m('x/1')]);
  });
});

test('modelScopeLabel', async (t) => {
  const projects = [{ name: 'Billing API', path: '/p/api/' }];

  await t.test('names the board project, else the folder', () => {
    assert.strictEqual(modelScopeLabel({ onlyIn: ['/p/api', '/q/tools'] }, projects), 'only in Billing API, tools');
  });

  await t.test('nothing for a model offered everywhere', () => {
    assert.strictEqual(modelScopeLabel({}, projects), undefined);
  });
});

test('modelOfferedIn', () => {
  assert.strictEqual(modelOfferedIn({}, '/anywhere'), true);
  assert.strictEqual(modelOfferedIn({ onlyIn: ['/p/api'] }, '/p/api/'), true);
  assert.strictEqual(modelOfferedIn({ onlyIn: ['/p/api'] }, '/p/api/src'), true);
  assert.strictEqual(modelOfferedIn({ onlyIn: ['/p/api'] }, '/p/apiary'), false);
});

test('withModelScopes and modelOptionLabel', () => {
  const [shared, local] = withModelScopes(
    [m('opencode/a'), { ...m('local/qwen'), onlyIn: ['/p/api'] }],
    [{ name: 'Billing API', path: '/p/api' }]
  );
  assert.strictEqual(shared!.scope, undefined);
  assert.strictEqual(modelOptionLabel(shared!), 'a');
  assert.strictEqual(modelOptionLabel(local!), 'qwen (only in Billing API)');
});
