import test from 'node:test';
import assert from 'node:assert';
import { calendarWindowStarts } from '../../../shared/spend/calendar.js';
import {
  barPct,
  costPerMillionTokens,
  dailySeries,
  OTHER_PROJECT,
  priorWindow,
  rankSessions,
  spendDeltaPct,
  summarizeSpend,
  windowFor
} from '../../../shared/spend/summary.js';
import { localAt, message } from '../../fixtures/spend.js';

test('Spend summary', async (t) => {
  await t.test('sums each window and ranks models and projects by cost', () => {
    const now = localAt(2026, 0, 14, 15);
    const summary = summarizeSpend(
      [
        message({ at: localAt(2026, 0, 14, 9), cost: 3, model: 'github-copilot/kimi-k3' }),
        message({ at: localAt(2026, 0, 13, 9), cost: 5, model: 'anthropic/claude-opus-5' }),
        message({ at: localAt(2026, 0, 5, 9), cost: 7, model: 'github-copilot/kimi-k3' }),
        message({ at: localAt(2025, 11, 30, 9), cost: 99, model: 'github-copilot/kimi-k3' })
      ],
      now
    );

    assert.strictEqual(summary.today.cost, 3);
    assert.strictEqual(summary.week.cost, 8);
    assert.strictEqual(summary.month.cost, 15, 'December work is outside the calendar month');
    assert.deepStrictEqual(summary.today.from, calendarWindowStarts(now).today);
    assert.strictEqual(summary.month.to, now);

    assert.deepStrictEqual(
      summary.byModel.map((bucket) => [bucket.label, bucket.cost, bucket.messages]),
      [['kimi-k3', 10, 2], ['claude-opus-5', 5, 1]]
    );
    assert.deepStrictEqual(summary.byProject.map((bucket) => bucket.label), ['agent-master-3000']);
  });

  await t.test('unmatched work groups as Other and unattributed turns still reconcile', () => {
    const now = localAt(2026, 0, 14, 15);
    const summary = summarizeSpend(
      [
        message({ at: localAt(2026, 0, 14, 9), cost: 2, project: undefined, model: undefined }),
        message({ at: localAt(2026, 0, 14, 10), cost: 1 })
      ],
      now
    );
    assert.deepStrictEqual(
      summary.byProject.map((bucket) => [bucket.key, bucket.cost]),
      [[OTHER_PROJECT, 2], ['agent-master-3000', 1]]
    );
    assert.strictEqual(
      summary.byModel.reduce((sum, bucket) => sum + bucket.cost, 0),
      summary.month.cost
    );
  });

  await t.test('daily series is zero-filled, oldest first, and covers today', () => {
    const from = localAt(2026, 0, 1, 0);
    const now = localAt(2026, 0, 4, 15);
    const series = dailySeries(
      [message({ at: localAt(2026, 0, 1, 9), cost: 2 }), message({ at: localAt(2026, 0, 4, 9), cost: 4 })],
      from,
      now
    );
    assert.deepStrictEqual(series, [
      { date: '2026-01-01', cost: 2 },
      { date: '2026-01-02', cost: 0 },
      { date: '2026-01-03', cost: 0 },
      { date: '2026-01-04', cost: 4 }
    ]);
  });

  await t.test('a window counts its turns and the sessions they ran in', () => {
    const from = localAt(2026, 0, 14, 0);
    const to = localAt(2026, 0, 15, 0);
    const window = windowFor(
      [
        message({ at: localAt(2026, 0, 14, 9), sessionId: 'ses_a', cost: 2, tokens: 300 }),
        message({ at: localAt(2026, 0, 14, 11), sessionId: 'ses_a', cost: 1, tokens: 200 }),
        message({ at: localAt(2026, 0, 14, 12), sessionId: 'ses_b', cost: 1, tokens: 500 }),
        message({ at: localAt(2026, 0, 13, 12), sessionId: 'ses_c', cost: 90, tokens: 90 })
      ],
      from,
      to
    );
    assert.deepStrictEqual(window, { from, to, cost: 4, tokens: 1_000, messages: 3, sessions: 2 });
    assert.strictEqual(costPerMillionTokens(window), 4_000, '$4 of spend over 1,000 tokens is $4,000 per million');
    assert.strictEqual(costPerMillionTokens({ from, to, cost: 0, tokens: 0 }), undefined);
  });

  await t.test('the week compares against the same slice of the week before', () => {
    const now = localAt(2026, 0, 14, 15);
    const messages = [
      message({ at: localAt(2026, 0, 12, 9), cost: 4 }),
      message({ at: localAt(2026, 0, 5, 9), cost: 10 }),
      // Last Wednesday evening — past the point this Wednesday has reached.
      message({ at: localAt(2026, 0, 7, 20), cost: 6 })
    ];
    const week = windowFor(messages, calendarWindowStarts(now, 'de-DE').week, now);
    const previous = priorWindow(messages, week, 7);
    assert.strictEqual(week.cost, 4);
    assert.strictEqual(previous.cost, 10, 'the evening after the cut-off belongs to neither slice');
    assert.strictEqual(spendDeltaPct(week.cost, previous.cost), -60);
    assert.strictEqual(spendDeltaPct(4, 0), undefined, 'nothing to compare a first week against');
  });

  await t.test('bars are measured against the top row, and anything spent keeps a stub', () => {
    assert.strictEqual(barPct(10, 10), 100);
    assert.strictEqual(barPct(5, 10), 50);
    assert.strictEqual(barPct(0.0001, 10), 2, 'a row that spent something is never invisible');
    assert.strictEqual(barPct(0, 10), 0);
    assert.strictEqual(barPct(3, 0), 0);
  });

  await t.test('the session ranking names rows, keeps the model that spent the most, and cuts at the limit', () => {
    const from = localAt(2026, 0, 1, 0);
    const now = localAt(2026, 0, 14, 15);
    const rows = rankSessions(
      [
        message({ sessionId: 'ses_a', at: localAt(2026, 0, 2), cost: 5, tokens: 500, sessionTitle: 'Kanban editor', model: 'anthropic/claude-opus-5' }),
        message({ sessionId: 'ses_a', at: localAt(2026, 0, 3), cost: 1, tokens: 100, sessionTitle: 'Kanban editor', model: 'github-copilot/kimi-k3' }),
        message({ sessionId: 'ses_b', at: localAt(2026, 0, 4), cost: 9, tokens: 900, sessionTitle: '', project: 'spa-frontend' }),
        message({ sessionId: 'ses_c', at: localAt(2026, 0, 4), cost: 2, tokens: 200, sessionTitle: 'Cheap one' }),
        // Outside the window entirely.
        message({ sessionId: 'ses_d', at: localAt(2025, 11, 30), cost: 99, sessionTitle: 'Last year' })
      ],
      from,
      now,
      2
    );

    assert.deepStrictEqual(rows, [
      { sessionId: 'ses_b', title: 'ses_b', model: 'github-copilot/kimi-k3', project: 'spa-frontend', cost: 9, tokens: 900, messages: 1 },
      { sessionId: 'ses_a', title: 'Kanban editor', model: 'anthropic/claude-opus-5', project: 'agent-master-3000', cost: 6, tokens: 600, messages: 2 }
    ]);
  });

  await t.test('the summary carries the agent ranking and the session table the design shows', () => {
    const now = localAt(2026, 0, 14, 15);
    const summary = summarizeSpend(
      [
        message({ sessionId: 'ses_a', at: localAt(2026, 0, 13, 9), cost: 4, agent: 'CEO', sessionTitle: 'Build it' }),
        message({ sessionId: 'ses_b', at: localAt(2026, 0, 13, 9), cost: 1, agent: undefined }),
        message({ sessionId: 'ses_c', at: localAt(2026, 0, 6, 9), cost: 3, agent: 'CEO' })
      ],
      now,
      'de-DE'
    );

    assert.deepStrictEqual(
      summary.byAgent.map((bucket) => [bucket.label, bucket.cost]),
      [['CEO', 7], ['Unknown agent', 1]]
    );
    assert.deepStrictEqual(summary.topSessions.map((row) => [row.title, row.cost]), [
      ['Build it', 4],
      ['ses_c', 3],
      ['ses_b', 1]
    ]);
    assert.strictEqual(summary.week.cost, 5);
    assert.strictEqual(summary.previousWeek.cost, 3, 'last week is read from the same messages');
    assert.strictEqual(summary.today.messages, 0);
  });
});
