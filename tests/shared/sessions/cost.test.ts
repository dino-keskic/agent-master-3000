import test from 'node:test';
import assert from 'node:assert';
import {
  billedSessionCost,
  contextFillPct,
  contextTone,
  contextTokensFromUsage,
  estimateCost,
  formatContext,
  apportionUsd,
  formatUsdExact,
  formatUsd,
  resolveSessionCost,
  totalSessionCost
} from '../../../shared/sessions/cost.js';
import { lookupModelInfo, overlayConfigLimits, parseModelCatalog, parseSessionModel } from '../../../server/opencode/models.js';

test('session cost and context formatting', async (t) => {
  await t.test('breakdown rows are rounded to add up to the total printed above them', () => {
    // The TASK-194 figures: right to six places, a cent apart once rounded.
    const rows = [3.843520, 1.426885, 0.106801];
    const total = 5.377206;
    assert.strictEqual(
      rows.reduce((sum, cost) => sum + Number(cost.toFixed(2)), 0).toFixed(2),
      '5.38',
      'rounding each row on its own is what drifts'
    );
    const shown = apportionUsd(rows, total);
    assert.deepStrictEqual(shown, [3.84, 1.43, 0.11]);
    assert.strictEqual(shown.reduce((sum, cost) => sum + cost, 0).toFixed(2), total.toFixed(2));
  });

  await t.test('apportioning never moves a row by more than its rounding, or below zero', () => {
    const rows = [0.005, 0.005, 0.005, 0.005];
    const shown = apportionUsd(rows, 0.02);
    assert.deepStrictEqual(shown, [0.01, 0.01, 0, 0]);
    assert.ok(shown.every((cost) => cost >= 0));
    assert.strictEqual(shown.reduce((sum, cost) => sum + cost, 0).toFixed(2), '0.02');
  });

  await t.test('a large total still apportions in cents, so no row is swallowed', () => {
    // formatUsd would print these as $11 and $3.00 beside each other, and round
    // the third away entirely. A breakdown column has to stay in one unit.
    const shown = apportionUsd([10.98, 2.755, 0.311886], 14.046887);
    // The odd cent goes to the row that lost the most rounding down.
    assert.deepStrictEqual(shown, [10.98, 2.76, 0.31]);
    assert.strictEqual(shown.reduce((sum, cost) => sum + cost, 0).toFixed(2), '14.05');
    assert.strictEqual(formatUsdExact(14.046887), '$14.05');
    assert.strictEqual(formatUsd(14.046887), '$14', 'the banded format is still there for figures quoted alone');
  });

  await t.test('an empty breakdown apportions to nothing', () => {
    assert.deepStrictEqual(apportionUsd([], 0), []);
  });

  await t.test('formatUsd hides empty and uses sensible precision', () => {
    assert.strictEqual(formatUsd(undefined), undefined);
    assert.strictEqual(formatUsd(0), undefined);
    assert.strictEqual(formatUsd(0.004), '<$0.01');
    assert.strictEqual(formatUsd(1.867962), '$1.87');
    assert.strictEqual(formatUsd(61.37), '$61');
    assert.strictEqual(formatUsd(114.7), '$115');
  });

  await t.test('formatContext shows last turn vs window', () => {
    assert.strictEqual(formatContext(175339, 500000), '175k / 500k');
    assert.strictEqual(formatContext(175339), '175k ctx');
    assert.strictEqual(formatContext(0, 200000), undefined);
    assert.strictEqual(contextFillPct(175339, 500000), 35);
  });

  await t.test('contextTokensFromUsage prefers tokens.total', () => {
    assert.strictEqual(contextTokensFromUsage({ total: 175339, input: 2, cacheRead: 173056 }), 175339);
    assert.strictEqual(contextTokensFromUsage({ input: 2143, output: 68, reasoning: 72, cacheRead: 173056 }), 175339);
  });

  await t.test('a fork is billed only for spend after the copy', () => {
    const fork = { origin: 'fork' as const, kind: 'btw' as const, forkedFrom: 'ses_main', costAtFork: 10, cost: 12 };
    assert.strictEqual(billedSessionCost(fork, 14), 4);
    assert.strictEqual(billedSessionCost(fork), 2);
    assert.strictEqual(billedSessionCost({ origin: 'initial', cost: 10 }, 10), 10);
    assert.strictEqual(billedSessionCost({ origin: 'fork', forkedFrom: 'ses_main' }, 12, 10), 2);
  });

  await t.test('task cost sums billed session costs', () => {
    assert.strictEqual(totalSessionCost([{ cost: 10 }, { cost: 2 }, { cost: 0 }]), 12);
    assert.strictEqual(totalSessionCost([{ cost: 0 }]), undefined);
  });

  await t.test('resolveSessionCost uses OpenCode stored cost, never cumulative cache totals', () => {
    const price = { input: 2, output: 6, cacheRead: 0.5 };
    const hugeCache = { input: 1_140_122, output: 230_566, cacheRead: 60_234_274 };
    assert.strictEqual(resolveSessionCost(61.37), 61.37);
    assert.strictEqual(resolveSessionCost(0), undefined);
    assert.notStrictEqual(estimateCost(hugeCache, price), 61.37);
  });

  await t.test('parseSessionModel reads OpenCode JSON and provider/id strings', () => {
    assert.deepStrictEqual(
      parseSessionModel('{"id":"grok-4.5","providerID":"github-copilot","variant":"high"}'),
      { provider: 'github-copilot', id: 'grok-4.5' }
    );
    assert.deepStrictEqual(parseSessionModel('github-copilot/gpt-5.4'), { provider: 'github-copilot', id: 'gpt-5.4' });
  });

  await t.test('catalog lookup finds cost and context limit', () => {
    const catalog = parseModelCatalog({
      'github-copilot': {
        models: {
          'grok-4.5': {
            name: 'Grok 4.5',
            limit: { context: 500000 },
            cost: { input: 2, output: 6, cache_read: 0.5 }
          }
        }
      }
    });
    const info = lookupModelInfo(catalog, 'github-copilot', 'grok-4.5');
    assert.strictEqual(info?.contextLimit, 500000);
    assert.strictEqual(info?.input, 2);
    assert.strictEqual(info?.cacheRead, 0.5);
  });

  await t.test('opencode.json context limits override the provider catalog', () => {
    const catalog = parseModelCatalog({
      'github-copilot': {
        models: {
          'gpt-5.4': {
            name: 'GPT-5.4',
            limit: { context: 1_050_000 },
            cost: { input: 2.5, output: 15 }
          },
          'kimi-k3': {
            name: 'Kimi K3',
            limit: { context: 1_048_576 },
            cost: { input: 3, output: 15 }
          },
          'grok-4.6': {
            name: 'Grok 4.6',
            limit: { context: 500000 },
            cost: { input: 2, output: 6 }
          }
        }
      }
    });
    overlayConfigLimits(catalog, {
      provider: {
        'github-copilot': {
          models: {
            'gpt-5.4': { limit: { context: 200000 } },
            'kimi-k3': { limit: { context: 200000 } }
          }
        }
      }
    });
    assert.strictEqual(lookupModelInfo(catalog, 'github-copilot', 'gpt-5.4')?.contextLimit, 200000);
    assert.strictEqual(lookupModelInfo(catalog, 'github-copilot', 'kimi-k3')?.contextLimit, 200000);
    assert.strictEqual(lookupModelInfo(catalog, undefined, 'gpt-5.4')?.contextLimit, 200000);
    assert.strictEqual(lookupModelInfo(catalog, 'github-copilot', 'gpt-5.4')?.input, 2.5);
    assert.strictEqual(
      lookupModelInfo(catalog, 'github-copilot', 'grok-4.6')?.contextLimit,
      500000,
      'unlisted catalog models keep their own window — a Copilot 200k cap does not rewrite grok-4.6'
    );
    assert.strictEqual(
      lookupModelInfo(catalog, 'github-copilot', 'claude-opus-4.7-fast')?.contextLimit,
      200000
    );
  });
});

test('the context meter warns before the window runs out', () => {
  assert.strictEqual(contextTone(undefined), 'ok');
  assert.strictEqual(contextTone(69), 'ok');
  assert.strictEqual(contextTone(70), 'warn');
  assert.strictEqual(contextTone(89), 'warn');
  assert.strictEqual(contextTone(90), 'full');
});
