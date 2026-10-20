import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinInFlight } from '../../../shared/http/inFlight';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('a second ask while the first is out joins it', async () => {
  const inFlight = new Map<string, Promise<number>>();
  const first = deferred<number>();
  let starts = 0;
  const start = () => {
    starts += 1;
    return first.promise;
  };
  const a = joinInFlight(inFlight, '/api/spend', start);
  const b = joinInFlight(inFlight, '/api/spend', start);
  assert.equal(starts, 1);
  first.resolve(7);
  assert.deepEqual(await Promise.all([a, b]), [7, 7]);
});

test('different keys run side by side', () => {
  const inFlight = new Map<string, Promise<number>>();
  let starts = 0;
  const start = () => {
    starts += 1;
    return new Promise<number>(() => {});
  };
  void joinInFlight(inFlight, 'a', start);
  void joinInFlight(inFlight, 'b', start);
  assert.equal(starts, 2);
});

test('once settled — resolved or failed — the next ask starts afresh', async () => {
  const inFlight = new Map<string, Promise<number>>();
  await joinInFlight(inFlight, 'k', () => Promise.resolve(1));
  assert.equal(inFlight.size, 0);
  await assert.rejects(joinInFlight(inFlight, 'k', () => Promise.reject(new Error('down'))));
  assert.equal(inFlight.size, 0);
  assert.equal(await joinInFlight(inFlight, 'k', () => Promise.resolve(2)), 2);
});
