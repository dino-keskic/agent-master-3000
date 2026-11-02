import test from 'node:test';
import assert from 'node:assert';
import { cwdCache } from '../../../server/toolCatalog/cache.js';

/** A load that answers at once. */
const answer = (value: string) => () => Promise.resolve(value);

/** A load that answers when told to, counting how often it was started. */
function gate<T>() {
  let calls = 0;
  let release: (value: T) => void = () => undefined;
  const load = () => {
    calls++;
    return new Promise<T>((resolve) => {
      release = resolve;
    });
  };
  return { load, calls: () => calls, release: (value: T) => release(value) };
}

test('callers asking at once share one load', async () => {
  const cache = cwdCache<string>();
  const g = gate<string>();
  const a = cache.read('/repo', g.load);
  const b = cache.read('/repo', g.load);
  g.release('tools');
  assert.deepStrictEqual(await Promise.all([a, b]), ['tools', 'tools']);
  assert.strictEqual(g.calls(), 1);
  assert.strictEqual(await cache.read('/repo', g.load), 'tools');
  assert.strictEqual(g.calls(), 1);
});

test('an aged answer comes back at once while a new one loads behind it', async () => {
  const cache = cwdCache<string>(0);
  await cache.read('/repo', answer('old'));
  const g = gate<string>();
  assert.strictEqual(await cache.read('/repo', g.load), 'old');
  assert.strictEqual(g.calls(), 1);
  g.release('new');
  await new Promise((resolve) => setImmediate(resolve));
  // Aged again at once (ttl 0), so this answers with what the load brought.
  assert.strictEqual(await cache.read('/repo', answer('newer')), 'new');
});

test('a failed refresh leaves the old answer standing', async () => {
  const cache = cwdCache<string>(0);
  await cache.read('/repo', answer('old'));
  assert.strictEqual(await cache.read('/repo', () => Promise.reject(new Error('down'))), 'old');
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(await cache.read('/repo', () => Promise.reject(new Error('down'))), 'old');
});

test('clearing a folder makes the next read wait, and drops a load already out', async () => {
  const cache = cwdCache<string>();
  const g = gate<string>();
  const first = cache.read('/repo::policy', g.load);
  cache.clear('/repo');
  g.release('before the clear');
  assert.strictEqual(await first, 'before the clear');
  assert.strictEqual(await cache.read('/repo::policy', answer('after')), 'after');
  await cache.read('/other', answer('kept'));
  cache.clear('/repo');
  assert.strictEqual(await cache.read('/other', answer('reloaded')), 'kept');
});
