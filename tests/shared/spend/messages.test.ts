import test from 'node:test';
import assert from 'node:assert';
import { copiedTurnKey, dropCopiedTurns, parseSpendMessage } from '../../../shared/spend/messages.js';
import { summarizeSpend } from '../../../shared/spend/summary.js';
import { message, row } from '../../fixtures/spend.js';

test('Spend messages', async (t) => {
  await t.test('parses cost, tokens processed and attribution off an assistant row', () => {
    const parsed = parseSpendMessage({
      sessionId: 'ses_a',
      messageId: 'msg_1',
      sessionCreatedAt: 7,
      at: 42,
      data: row(),
      project: 'agent-master-3000',
      sessionTitle: 'Kanban column editor'
    });
    assert.deepStrictEqual(parsed, {
      sessionId: 'ses_a',
      at: 42,
      cost: 0.0175,
      // Cached input is billed and was processed, so it counts: 100 + 40 + 10
      // new tokens on top of a 4,346-token cache read.
      tokens: 4_496,
      messageId: 'msg_1',
      sessionCreatedAt: 7,
      copyKey: copiedTurnKey(JSON.parse(row())),
      model: 'github-copilot/gpt-5.6-terra',
      agent: 'CEO',
      project: 'agent-master-3000',
      sessionTitle: 'Kanban column editor'
    });
  });

  await t.test('drops rows that carry no spend', () => {
    assert.strictEqual(parseSpendMessage({ sessionId: 'a', at: 1, data: '{"role":"user"}' }), undefined);
    assert.strictEqual(parseSpendMessage({ sessionId: 'a', at: 1, data: 'not json' }), undefined);
    assert.strictEqual(
      parseSpendMessage({ sessionId: 'a', at: 1, data: row({ cost: 0, tokens: {} }) }),
      undefined
    );
  });
});

test('copied turns', async (t) => {
  // What OpenCode's fork (and the board's clone) does to a message: new ids and
  // a new parentID; the time, cost, tokens and model are carried over as-is.
  const original = JSON.parse(row({ parentID: 'msg_user_a', time: { created: 1_000, completed: 4_000 } }));
  const copy = { ...original, parentID: 'msg_user_fork' };

  await t.test('a copy has the key of its original, whatever it now points at', () => {
    assert.ok(copiedTurnKey(original));
    assert.strictEqual(copiedTurnKey(copy), copiedTurnKey(original));
  });

  await t.test('another turn does not share the key', () => {
    assert.notStrictEqual(copiedTurnKey({ ...original, time: { created: 1_000, completed: 4_001 } }), copiedTurnKey(original));
    assert.notStrictEqual(copiedTurnKey({ ...original, cost: 0.02 }), copiedTurnKey(original));
    assert.notStrictEqual(copiedTurnKey({ ...original, modelID: 'other' }), copiedTurnKey(original));
  });

  await t.test('a turn without both timestamps is never merged', () => {
    assert.strictEqual(copiedTurnKey({ ...original, time: { created: 1_000 } }), undefined);
    assert.strictEqual(copiedTurnKey({ ...original, time: undefined }), undefined);
  });

  const turn = (sessionId: string, sessionCreatedAt: number, messageId: string, data: object, project = 'agent-master-3000') =>
    parseSpendMessage({ sessionId, sessionCreatedAt, messageId, at: 1_000, data: JSON.stringify(data), project })!;

  await t.test('each turn is counted once, in the session it was spent in', () => {
    // Read in session order, the fork can come first; the oldest session still wins.
    const kept = dropCopiedTurns([
      turn('ses_fork', 5_000, 'msg_0d7855845001', copy, 'Other'),
      turn('ses_main', 500, 'msg_0d785510e001', original),
      turn('ses_fork_of_fork', 6_000, 'msg_0d7856000001', copy, 'Other')
    ]);
    assert.strictEqual(kept.length, 1);
    assert.strictEqual(kept[0]!.sessionId, 'ses_main');
    assert.strictEqual(kept[0]!.project, 'agent-master-3000');
  });

  await t.test('a fork made after the ids wrapped does not take the turn over', () => {
    // 48 bits of ms * 0x1000 roll over every 795 days; a fork on the far side
    // of a rollover has lower ids than the conversation it copied.
    const kept = dropCopiedTurns([
      turn('ses_main', 500, 'msg_fffff0000001', original),
      turn('ses_fork', 5_000, 'msg_000010000001', copy, 'Other')
    ]);
    assert.deepStrictEqual(kept.map((m) => m.sessionId), ['ses_main']);
  });

  await t.test('with the session ages unknown, the lower id is the original', () => {
    const kept = dropCopiedTurns([
      parseSpendMessage({ sessionId: 'ses_fork', messageId: 'msg_2', at: 1_000, data: JSON.stringify(copy) })!,
      parseSpendMessage({ sessionId: 'ses_main', messageId: 'msg_1', at: 1_000, data: JSON.stringify(original) })!
    ]);
    assert.deepStrictEqual(kept.map((m) => m.sessionId), ['ses_main']);
  });

  await t.test('what a fork spends after the copy is its own', () => {
    const later = { ...original, time: { created: 9_000, completed: 9_500 } };
    const kept = dropCopiedTurns([
      turn('ses_main', 500, 'msg_0d785510e001', original),
      turn('ses_fork', 5_000, 'msg_0d7855845001', copy),
      turn('ses_fork', 5_000, 'msg_0d7855900001', later)
    ]);
    assert.deepStrictEqual(kept.map((m) => m.messageId), ['msg_0d785510e001', 'msg_0d7855900001']);
    assert.strictEqual(summarizeSpend(kept, 10_000).month.cost, 0.035);
  });

  await t.test('rows without a key pass through, and nothing to drop keeps the array', () => {
    const plain = [message({ sessionId: 'a' }), message({ sessionId: 'b' })];
    assert.strictEqual(dropCopiedTurns(plain), plain);
  });
});
