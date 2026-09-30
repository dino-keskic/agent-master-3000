import test from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { mentionFromUrl } from '../../../shared/trackers/mentions.js';
import { mentionContext, resolveMention } from '../../../server/trackers/index.js';
import { workflowRunStatus } from '../../../server/trackers/actions.js';
import { FIXTURES_DIR } from '../../fixtures/paths.js';

/**
 * A pasted Actions run, end to end against the stand-in `gh` in
 * `fixtures/cli`: the title and status behind the link, the summary fetched on
 * paste, and the two "everything" blocks — every job, and the failed logs.
 */
process.env.PATH = `${path.join(FIXTURES_DIR, 'cli')}:${process.env.PATH || ''}`;

const run = mentionFromUrl('https://github.com/acme/web-app/actions/runs/777')!;

test('a pasted run resolves to its workflow and title', async () => {
  const { item, error } = await resolveMention(run);
  assert.strictEqual(error, undefined);
  assert.strictEqual(item?.title, 'CI: Fix the plan editor unit cap');
  assert.strictEqual(item?.status, 'failure');
});

test('the summary names the red job and the step that failed', async () => {
  const { body, error } = await mentionContext(run, 'description');
  assert.strictEqual(error, undefined);
  assert.ok(body.includes('- failure: test (node 22)'), body);
  assert.ok(body.includes('✗ step 4: npm test'), body);
  assert.ok(body.includes('2 other jobs passed or were skipped.'), body);
});

test('all jobs and the failed logs come on request', async () => {
  const jobs = await mentionContext(run, 'jobs');
  assert.ok(jobs.body.includes('test (node 22) — failure (3m 10s)'), jobs.body);
  const logs = await mentionContext(run, 'logs');
  assert.strictEqual(logs.error, undefined);
  assert.strictEqual(
    logs.body,
    [
      '## test (node 22) › npm test',
      '✖ unit cap clamps to the plan maximum',
      '  AssertionError: expected 12 to equal 10',
      '  at tests/planEditor.test.ts:41:10'
    ].join('\n')
  );
});

test('the link badge learns the run failed', async () => {
  const read = await workflowRunStatus('acme/web-app', 777);
  assert.deepStrictEqual(read, { title: 'CI: Fix the plan editor unit cap', status: { state: 'failed', label: 'failure' } });
});

test('a run gh does not know fails softly', async () => {
  const missing = mentionFromUrl('https://github.com/acme/web-app/actions/runs/1')!;
  const { item, error } = await resolveMention(missing);
  assert.strictEqual(item, undefined);
  assert.ok(error);
});
