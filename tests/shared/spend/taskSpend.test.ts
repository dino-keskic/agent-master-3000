import test from 'node:test';
import assert from 'node:assert';
import { phaseLabel, sessionSpendTotal, spendSessionIds, summarizeTaskSpend } from '../../../shared/spend/taskSpend.js';
import { message } from '../../fixtures/spend.js';

test('Task spend', async (t) => {
  await t.test('a phase reads as where the session sits, then what it is called', () => {
    assert.strictEqual(
      phaseLabel({ title: 'Rework the drawer', kind: 'stage', origin: 'stage' }, 'Execute'),
      'Execute · Rework the drawer'
    );
    assert.strictEqual(phaseLabel({ title: 'Why is this slow?', kind: 'btw' }), 'Fork · Why is this slow?');
    assert.strictEqual(phaseLabel({ title: '', kind: 'main', origin: 'initial' }), 'Main');
  });

  await t.test('task spend rolls subagents into their phase and every breakdown sums to the total', () => {
    const phases = [
      { key: 'ses_main', sessionId: 'ses_main', label: 'Execute · Build it', sessionIds: ['ses_main', 'ses_kid1', 'ses_kid2'] },
      { key: 'ses_fork', sessionId: 'ses_fork', label: 'Fork · Why is this slow?', sessionIds: ['ses_fork'] },
      { key: 'ses_quiet', sessionId: 'ses_quiet', label: 'Main · Nothing ran here', sessionIds: ['ses_quiet'] }
    ];
    const breakdown = summarizeTaskSpend('TASK-145', phases, [
      message({ sessionId: 'ses_main', cost: 10, tokens: 1_000, agent: 'build' }),
      message({ sessionId: 'ses_kid1', cost: 4, tokens: 400, agent: 'review', model: 'anthropic/claude-opus-5' }),
      message({ sessionId: 'ses_kid2', cost: 3, tokens: 300, agent: 'review', model: 'anthropic/claude-opus-5' }),
      message({ sessionId: 'ses_fork', cost: 1, tokens: 100, agent: 'build' }),
      message({ sessionId: 'ses_elsewhere', cost: 99, tokens: 9_999 })
    ]);

    assert.strictEqual(breakdown.total, 18, 'a session outside the task never counts');
    assert.strictEqual(breakdown.tokens, 1_800);
    assert.deepStrictEqual(
      breakdown.byPhase.map((bucket) => [bucket.label, bucket.cost]),
      [['Execute · Build it', 17], ['Fork · Why is this slow?', 1], ['Main · Nothing ran here', 0]]
    );
    assert.deepStrictEqual(
      breakdown.byAgent.map((bucket) => [bucket.label, bucket.cost]),
      [['build', 11], ['review', 7]]
    );
    for (const rows of [breakdown.byPhase, breakdown.byModel, breakdown.byAgent]) {
      assert.strictEqual(rows.reduce((sum, bucket) => sum + bucket.cost, 0), breakdown.total);
    }
  });

  await t.test('a fork does not rebill the conversation it copied', () => {
    const breakdown = summarizeTaskSpend(
      'TASK-1',
      [
        { key: 'ses_main', sessionId: 'ses_main', label: 'Main', sessionIds: ['ses_main'] },
        { key: 'ses_fork', sessionId: 'ses_fork', label: 'Fork', sessionIds: ['ses_fork'], billedAfter: 100 }
      ],
      [
        message({ sessionId: 'ses_main', at: 50, cost: 10 }),
        message({ sessionId: 'ses_fork', at: 50, cost: 10 }),
        message({ sessionId: 'ses_fork', at: 150, cost: 2 })
      ]
    );
    assert.strictEqual(breakdown.total, 12);
    assert.deepStrictEqual(breakdown.byPhase.map((bucket) => bucket.cost), [10, 2]);
    // The copied conversation is out of every breakdown, not just the phase
    // rows — grouping it into the model and agent rows made them sum past the
    // total the drawer prints right above them.
    for (const rows of [breakdown.byModel, breakdown.byAgent]) {
      assert.strictEqual(rows.reduce((sum, bucket) => sum + bucket.cost, 0), breakdown.total);
    }
  });

  await t.test('a session that crossed a stage splits its spend at the move', () => {
    const breakdown = summarizeTaskSpend(
      'TASK-194',
      [
        { key: 'ses_a#0', sessionId: 'ses_a', label: 'Plan · Investigate', sessionIds: ['ses_a', 'ses_kid'], billedBefore: 100 },
        { key: 'ses_a#1', sessionId: 'ses_a', label: 'Execute · Investigate', sessionIds: ['ses_a', 'ses_kid'], billedAfter: 100 }
      ],
      [
        message({ sessionId: 'ses_a', at: 50, cost: 3 }),
        // A subagent turn lands in the stretch its timestamp falls in, not in
        // whichever stage its parent session started in.
        message({ sessionId: 'ses_kid', at: 60, cost: 1 }),
        message({ sessionId: 'ses_a', at: 150, cost: 5 }),
        message({ sessionId: 'ses_kid', at: 160, cost: 2 })
      ]
    );

    assert.strictEqual(breakdown.total, 11);
    assert.deepStrictEqual(
      breakdown.byPhase.map((bucket) => [bucket.label, bucket.cost]),
      [['Plan · Investigate', 4], ['Execute · Investigate', 7]]
    );
  });

  await t.test('the stages of one session are read once, not once per stage', () => {
    // Every stage row names the same session and the same subagent tree. Read
    // per row, a task that moved column once bills exactly twice what it spent.
    assert.deepStrictEqual(
      spendSessionIds([
        { key: 'ses_a#0', sessionId: 'ses_a', label: 'Plan', sessionIds: ['ses_a', 'ses_kid'], billedBefore: 100 },
        { key: 'ses_a#1', sessionId: 'ses_a', label: 'Execute', sessionIds: ['ses_a', 'ses_kid'], billedAfter: 100 },
        { key: 'ses_b', sessionId: 'ses_b', label: 'Fork', sessionIds: ['ses_b'] }
      ]),
      ['ses_a', 'ses_kid', 'ses_b']
    );
  });

  await t.test('phase rows stay in stage order rather than being ranked by cost', () => {
    const breakdown = summarizeTaskSpend(
      'TASK-194',
      [
        { key: 'ses_a#0', sessionId: 'ses_a', label: 'Plan', sessionIds: ['ses_a'], billedBefore: 100 },
        { key: 'ses_a#1', sessionId: 'ses_a', label: 'Execute', sessionIds: ['ses_a'], billedAfter: 100 }
      ],
      [message({ sessionId: 'ses_a', at: 50, cost: 1 }), message({ sessionId: 'ses_a', at: 150, cost: 9 })]
    );
    assert.deepStrictEqual(breakdown.byPhase.map((bucket) => bucket.label), ['Plan', 'Execute']);
  });

  await t.test('a session claimed by an earlier phase is never counted twice', () => {
    const breakdown = summarizeTaskSpend(
      'TASK-1',
      [
        { key: 'ses_a', sessionId: 'ses_a', label: 'Main', sessionIds: ['ses_a', 'ses_kid'] },
        { key: 'ses_b', sessionId: 'ses_b', label: 'Fork', sessionIds: ['ses_b'] }
      ],
      [message({ sessionId: 'ses_kid', cost: 5 }), message({ sessionId: 'ses_b', cost: 2 })]
    );
    assert.strictEqual(breakdown.total, 7);
    assert.deepStrictEqual(breakdown.byPhase.map((bucket) => bucket.cost), [5, 2]);
  });
});

test('sessionSpendTotal', async (t) => {
  const breakdown = summarizeTaskSpend(
    'TASK-209',
    [
      { key: 'ses_a#0', sessionId: 'ses_a', label: 'Plan', sessionIds: ['ses_a', 'ses_kid'], billedBefore: 100 },
      { key: 'ses_a#1', sessionId: 'ses_a', label: 'Execute', sessionIds: ['ses_a', 'ses_kid'], billedAfter: 100 },
      { key: 'ses_b', sessionId: 'ses_b', label: 'Fork', sessionIds: ['ses_b'] }
    ],
    [
      message({ sessionId: 'ses_a', at: 50, cost: 1 }),
      message({ sessionId: 'ses_kid', at: 150, cost: 4 }),
      message({ sessionId: 'ses_b', at: 150, cost: 2 })
    ]
  );

  await t.test('adds up every stage of a session, subagents included', () => {
    assert.strictEqual(sessionSpendTotal(breakdown, 'ses_a'), 5);
  });

  await t.test('a one-stage session is its own row', () => {
    assert.strictEqual(sessionSpendTotal(breakdown, 'ses_b'), 2);
  });

  await t.test("the sessions' totals add up to the task total", () => {
    const parts = ['ses_a', 'ses_b'].map((id) => sessionSpendTotal(breakdown, id) ?? 0);
    assert.strictEqual(parts.reduce((a, b) => a + b, 0), breakdown.total);
  });

  await t.test('says nothing rather than zero when there is no row for the session', () => {
    assert.strictEqual(sessionSpendTotal(breakdown, 'ses_never_ran'), undefined);
    assert.strictEqual(sessionSpendTotal(null, 'ses_a'), undefined);
    assert.strictEqual(sessionSpendTotal(breakdown, undefined), undefined);
  });

  await t.test('a stage that cost nothing still counts as a read of that session', () => {
    const idle = summarizeTaskSpend('TASK-1', [{ key: 'ses_c', sessionId: 'ses_c', label: 'Backlog', sessionIds: ['ses_c'] }], []);
    assert.strictEqual(sessionSpendTotal(idle, 'ses_c'), 0);
  });
});
