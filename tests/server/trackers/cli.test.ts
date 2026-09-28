import test from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { MentionItem } from '../../../shared/trackers/mentions.js';
import { mentionContext, resolveMention, searchMentions } from '../../../server/trackers/index.js';
import { searchGithub } from '../../../server/trackers/github.js';
import { jiraComments, jiraDescription } from '../../../server/trackers/jira.js';
import { FIXTURES_DIR } from '../../fixtures/paths.js';

/**
 * The mention lookups, end to end, against the stand-in CLIs in
 * `fixtures/cli` — the shell-out, the JSON, the ADF and the summarising, with
 * no account anywhere. The real `acli` and `gh` are never reached: the fixture
 * directory goes on the front of PATH.
 */
process.env.PATH = `${path.join(FIXTURES_DIR, 'cli')}:${process.env.PATH || ''}`;
// Jira search stays off until the board is told which site to link to, so the
// suite names one — the same one the fixture CLI's keys are expected to land on.
process.env.JIRA_SITE = 'example.atlassian.net';

const ticket: MentionItem = {
  kind: 'jira',
  id: 'SANDBOX-1',
  title: 'Invoice editor drops line items',
  url: 'https://example.atlassian.net/browse/SANDBOX-1'
};

const pr: MentionItem = {
  kind: 'github',
  id: 'web-app#9404',
  title: 'Fix the plan editor unit cap',
  url: 'https://github.com/acme/web-app/pull/9404'
};

test('the menu lists what the CLIs return, both sources at once', async () => {
  const { items, error } = await searchMentions('');
  assert.strictEqual(error, undefined);
  assert.ok(items.some((item) => item.kind === 'jira' && item.id === 'SANDBOX-1'));
  assert.ok(items.some((item) => item.kind === 'github' && item.id === 'web-app#9404'));
  const found = items.find((item) => item.id === 'SANDBOX-1');
  assert.strictEqual(found?.title, 'Invoice editor drops line items');
  assert.strictEqual(found?.status, 'In Progress');
  assert.strictEqual(found?.url, 'https://example.atlassian.net/browse/SANDBOX-1', 'the link uses JIRA_SITE');
});

test('a Jira description comes back as markdown, not an ADF blob', async () => {
  const { body, error } = await mentionContext(ticket, 'description');
  assert.strictEqual(error, undefined);
  assert.ok(body.includes('## What happens'), body);
  assert.ok(body.includes('**editor**'));
  assert.ok(body.includes('[the sync thread](https://example.invalid/thread)'));
  assert.ok(body.includes('- Only on iOS.'));
  assert.ok(body.includes('```json'));
});

test('Jira comments keep their markdown, and a screenshot-only one says so', async () => {
  const { body } = await mentionContext(ticket, 'comments');
  assert.ok(body.includes('**Ada Lovelace** — 2026-05-05'));
  assert.ok(body.includes('_(no text — attachment or embed)_'), body);
  assert.ok(body.includes('**Grace Hopper** — 2026-05-15'));
  assert.ok(body.includes('`PlanEditor.tsx`'), 'inline code survives the ADF');
  assert.ok(body.includes('1. The cap in the reducer.'), 'so do ordered lists');
});

test('a PR description loses the template boilerplate and keeps the branches', async () => {
  const { body } = await mentionContext(pr, 'description');
  assert.ok(body.includes('Fix the plan editor unit cap'));
  assert.ok(body.includes('fix/plan-editor-cap → main'));
  assert.ok(body.includes('Drops the cap in the reducer.'));
  assert.ok(!body.includes('do not edit'), 'the HTML comment is not something a reader needs');
});

test('PR reviews come through with their state', async () => {
  const { body } = await mentionContext(pr, 'comments');
  assert.ok(body.includes('**@grace-h** — CHANGES_REQUESTED · 2026-05-16'), body);
  assert.ok(body.includes('**@ada-l**'));
});

test('failing checks are listed and the green ones are counted', async () => {
  const { body } = await mentionContext(pr, 'checks');
  assert.ok(body.startsWith('1 fail · 1 pending · 12 pass'), body);
  assert.ok(body.includes('FAILURE: unit (CI) — 2 tests failed'));
  assert.ok(body.includes('IN_PROGRESS: e2e (CI)'));
  assert.ok(body.includes('12 other checks passed or were skipped.'));
  assert.ok(!body.includes('lint-1'), 'a hundred green rows is the part nobody needed');
});

/* --------------------------- resolving a paste --------------------------- */

test('a pasted Jira link is looked up by key, on whatever site it came from', async () => {
  const pasted: MentionItem = {
    kind: 'jira',
    id: 'SANDBOX-2',
    title: '',
    // Not JIRA_SITE. A pasted link brings its own site, and the lookup is by
    // key — configuring the board is not a precondition for pasting.
    url: 'https://elsewhere.atlassian.net/browse/SANDBOX-2'
  };
  const { item, error } = await resolveMention(pasted);
  assert.strictEqual(error, undefined);
  assert.strictEqual(item?.title, 'Sync retries forever after a 409');
  assert.strictEqual(item?.status, 'To Do');
  assert.strictEqual(item?.subtitle, 'Task');
  assert.strictEqual(item?.url, pasted.url, 'the pasted URL is what the link keeps pointing at');
  assert.strictEqual(item?.id, 'SANDBOX-2');
});

test('a pasted PR link picks up its title and draft state', async () => {
  const { item, error } = await resolveMention({
    kind: 'github',
    id: 'agent-master-3000#12',
    title: '',
    url: 'https://github.com/acme/agent-master-3000/pull/12'
  });
  assert.strictEqual(error, undefined);
  assert.strictEqual(item?.title, 'Link tickets with @ instead of pasting them');
  assert.strictEqual(item?.status, 'Draft');
  assert.strictEqual(item?.subtitle, 'acme/agent-master-3000');
});

test('a link to something that is not there fails softly', async () => {
  const { item, error } = await resolveMention({
    kind: 'jira',
    id: 'SANDBOX-404',
    title: '',
    url: 'https://elsewhere.atlassian.net/browse/SANDBOX-404'
  });
  assert.strictEqual(item, undefined);
  assert.match(error || '', /SANDBOX-404/);
});

test('a search that starts with a dash is searched for, not handed to gh as a flag', async () => {
  // Without `--` in front of it, `--web` would make gh open a browser. The
  // stand-in gh drops a flag from the search terms the way gh does, so a flag
  // would come back as "every PR"; a search term finds nothing by that name.
  assert.deepStrictEqual(await searchGithub('--web'), []);
});

test('an id that is not a Jira key never reaches acli', async () => {
  await assert.rejects(jiraDescription({ ...ticket, id: '--help' }), /Not a Jira key/);
  await assert.rejects(jiraComments({ ...ticket, id: 'SANDBOX-1 --json' }), /Not a Jira key/);
  const { error } = await mentionContext({ ...ticket, id: '--help' }, 'description');
  assert.ok(error);
});
