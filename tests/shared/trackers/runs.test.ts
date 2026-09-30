import test from 'node:test';
import assert from 'node:assert';
import {
  GhRun,
  failedJobIds,
  formatRunJobs,
  formatRunSummary,
  normalizeRunStatus,
  runTitle,
  tidyFailedLog
} from '../../../shared/trackers/runs.js';

const run: GhRun = {
  databaseId: 5,
  workflowName: 'CI',
  displayTitle: 'Fix login loop',
  status: 'completed',
  conclusion: 'failure',
  event: 'pull_request',
  headBranch: 'fix/login',
  headSha: 'abcdef1234567',
  jobs: [
    { databaseId: 1, name: 'lint', conclusion: 'success', status: 'completed', steps: [{ number: 1, name: 'eslint', conclusion: 'success' }] },
    {
      databaseId: 2,
      name: 'test (node 22)',
      conclusion: 'failure',
      status: 'completed',
      url: 'https://github.com/acme/web/actions/runs/5/job/2',
      startedAt: '2026-09-30T10:00:00Z',
      completedAt: '2026-09-30T10:02:05Z',
      steps: [
        { number: 1, name: 'checkout', conclusion: 'success' },
        { number: 4, name: 'npm test', conclusion: 'failure' },
        { number: 5, name: 'upload', conclusion: 'skipped' }
      ]
    },
    { databaseId: 3, name: 'build', conclusion: 'skipped', status: 'completed' }
  ]
};

test('normalizeRunStatus: running is open, green is done, red is failed, called off is closed', () => {
  assert.deepStrictEqual(normalizeRunStatus('in_progress', ''), { state: 'open', label: 'in progress', stage: 'active' });
  assert.deepStrictEqual(normalizeRunStatus('queued', null), { state: 'open', label: 'queued', stage: 'todo' });
  assert.deepStrictEqual(normalizeRunStatus('completed', 'success'), { state: 'done', label: 'success' });
  assert.deepStrictEqual(normalizeRunStatus('completed', 'timed_out'), { state: 'failed', label: 'timed out' });
  assert.deepStrictEqual(normalizeRunStatus('completed', 'cancelled'), { state: 'closed', label: 'cancelled' });
  assert.strictEqual(normalizeRunStatus(undefined, undefined), null);
});

test('runTitle names the workflow and what it ran for', () => {
  assert.strictEqual(runTitle(run), 'CI: Fix login loop');
  assert.strictEqual(runTitle({ workflowName: 'Nightly', displayTitle: 'Nightly' }), 'Nightly');
  assert.strictEqual(runTitle({}), undefined);
});

test('the summary names the red job and its failed step, and counts the rest', () => {
  assert.strictEqual(
    formatRunSummary(run),
    [
      'CI: Fix login loop',
      'failure · branch fix/login @abcdef1 on pull_request',
      '',
      '- failure: test (node 22)',
      '  https://github.com/acme/web/actions/runs/5/job/2',
      '  ✗ step 4: npm test',
      '2 other jobs passed or were skipped.'
    ].join('\n')
  );
  // A job link is about that job.
  assert.ok(formatRunSummary(run, 1).endsWith('All 1 jobs passed or were skipped.'));
});

test('all jobs lists every step with how it went', () => {
  const text = formatRunJobs(run);
  assert.ok(text.includes('test (node 22) — failure (2m 5s)'));
  assert.ok(text.includes('  ✗ 4. npm test — failure'));
  assert.ok(text.includes('  ✓ 1. eslint — success'));
  assert.ok(text.includes('  · 5. upload — skipped'));
  assert.ok(text.includes('build — skipped'));
});

test('failedJobIds finds the red jobs, scoped to a job link', () => {
  assert.deepStrictEqual(failedJobIds(run), [2]);
  assert.deepStrictEqual(failedJobIds(run, 1), []);
});

test('tidyFailedLog drops colour and timestamps, groups by step and keeps the end', () => {
  const raw = [
    'test (node 22)\tnpm test\t2026-09-30T10:01:00.1234567Z \u001b[31mFAIL\u001b[0m login.test.ts',
    'test (node 22)\tnpm test\t2026-09-30T10:01:01.0000000Z Expected 1, got 2'
  ].join('\n');
  assert.strictEqual(tidyFailedLog(raw), '## test (node 22) › npm test\nFAIL login.test.ts\nExpected 1, got 2');

  const long = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
  const cut = tidyFailedLog(long, 100);
  assert.ok(cut.startsWith('…earlier lines cut…\n'));
  assert.ok(cut.endsWith('line 199'));
  assert.ok(cut.length < 130);
  assert.strictEqual(tidyFailedLog(''), '');
});
