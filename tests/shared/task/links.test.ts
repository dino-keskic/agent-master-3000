import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { TEST_DATA_DIR } from '../../fixtures/taskStore.js';
import {
  buildTaskLink,
  classifyLink,
  defaultLinkTitle,
  extractLinks,
  extractTrackerLinks,
  formatTaskLink,
  httpUrl,
  MAX_TASK_LINKS,
  mergeTaskLinks,
  normalizeLinkUrl,
  showRef,
  sortTaskLinks,
  trackerLinks
} from '../../../shared/task/links.js';
import { TaskLink } from '../../../shared/types.js';
import { TaskStore } from '../../../server/board/taskStore.js';

function link(url: string, over: Partial<TaskLink> = {}): TaskLink {
  return buildTaskLink({ url }, over.id || url, over.source || 'user', over.createdAt || 1)!;
}

test('normalizeLinkUrl gives one spelling per page', () => {
  assert.strictEqual(normalizeLinkUrl('https://Example.com/A/'), 'https://example.com/A');
  assert.strictEqual(normalizeLinkUrl('  github.com/a/b/pull/1  '), 'https://github.com/a/b/pull/1');
  // URLs are usually read out of prose, wearing the sentence's punctuation.
  assert.strictEqual(normalizeLinkUrl('<https://example.com/x>.'), 'https://example.com/x');
  assert.strictEqual(normalizeLinkUrl('https://example.com/x?a=1#b'), 'https://example.com/x?a=1#b');

  assert.strictEqual(normalizeLinkUrl(''), null);
  assert.strictEqual(normalizeLinkUrl('not a url'), null);
  assert.strictEqual(normalizeLinkUrl('javascript:alert(1)'), null);
  assert.strictEqual(normalizeLinkUrl('file:///etc/passwd'), null);
  assert.strictEqual(normalizeLinkUrl('localhost/x'), null);
});

test("httpUrl lets an agent's link through only if it is a web page", () => {
  assert.equal(httpUrl('https://acme.example/login?code=1'), 'https://acme.example/login?code=1');
  assert.equal(httpUrl('http://127.0.0.1:8080/cb'), 'http://127.0.0.1:8080/cb');
  for (const raw of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,<b>x</b>', 'file:///etc/passwd', 'vbscript:x', 'acme.example', '', undefined, 42]) {
    assert.equal(httpUrl(raw), undefined, String(raw));
  }
});

test('classifyLink names the tracked work behind a URL', () => {
  assert.deepStrictEqual(classifyLink('https://github.com/acme/web/pull/9404'), {
    kind: 'pr',
    ref: 'acme/web#9404'
  });
  assert.deepStrictEqual(classifyLink('https://github.com/acme/web/issues/12'), {
    kind: 'issue',
    ref: 'acme/web#12'
  });
  assert.deepStrictEqual(classifyLink('https://github.com/acme/web/commit/0123456789abcdef'), {
    kind: 'commit',
    ref: 'acme/web@0123456'
  });
  assert.deepStrictEqual(classifyLink('https://acme.atlassian.net/browse/WEB-1234'), {
    kind: 'jira',
    ref: 'WEB-1234'
  });
  assert.deepStrictEqual(
    classifyLink('https://acme.atlassian.net/jira/software/c/projects/WEB/boards/3?selectedIssue=WEB-1234'),
    { kind: 'jira', ref: 'WEB-1234' }
  );
  assert.strictEqual(classifyLink('https://docs.google.com/document/d/abc').kind, 'doc');
  assert.strictEqual(classifyLink('https://acme.atlassian.net/wiki/spaces/ENG/pages/1').kind, 'doc');
  assert.strictEqual(classifyLink('https://example.com/anything').kind, 'link');
});

test('buildTaskLink fills in a title and refuses what is not a link', () => {
  const pr = buildTaskLink({ url: 'https://github.com/acme/web/pull/9404' }, 'l1', 'agent', 5);
  assert.deepStrictEqual(pr, {
    id: 'l1',
    url: 'https://github.com/acme/web/pull/9404',
    title: 'acme/web#9404',
    kind: 'pr',
    ref: 'acme/web#9404',
    note: undefined,
    source: 'agent',
    createdAt: 5
  });

  assert.strictEqual(defaultLinkTitle('https://www.example.com/a/b'), 'example.com/a/b');
  assert.strictEqual(buildTaskLink({ url: 'nope' }, 'l2'), null);
  assert.strictEqual(
    buildTaskLink({ url: 'https://example.com/x', title: '  Design   doc ' }, 'l3')!.title,
    'Design doc'
  );
});

test('mergeTaskLinks edits by URL rather than stacking copies', () => {
  const existing = [link('https://github.com/acme/web/pull/1', { id: 'a' })];
  existing[0]!.title = 'The rename PR';

  // A bare re-add — what the agent does every turn — must not blank the title.
  const same = mergeTaskLinks(existing, [link('https://github.com/acme/web/pull/1', { id: 'b' })]);
  assert.strictEqual(same.links.length, 1);
  assert.strictEqual(same.links[0]!.id, 'a');
  assert.strictEqual(same.links[0]!.title, 'The rename PR');
  assert.deepStrictEqual(same.added, []);
  assert.deepStrictEqual(same.updated, []);

  const titled = mergeTaskLinks(same.links, [
    buildTaskLink({ url: 'https://github.com/acme/web/pull/1', note: 'opened by this task' }, 'c', 'agent', 9)!
  ]);
  assert.strictEqual(titled.links.length, 1);
  assert.strictEqual(titled.links[0]!.note, 'opened by this task');
  assert.strictEqual(titled.links[0]!.title, 'The rename PR');
  assert.strictEqual(titled.links[0]!.updatedAt, 9);
  assert.strictEqual(titled.updated.length, 1);

  const added = mergeTaskLinks(titled.links, [link('https://acme.atlassian.net/browse/AB-1', { id: 'd' })]);
  assert.strictEqual(added.links.length, 2);
  assert.strictEqual(added.added.length, 1);
});

test('mergeTaskLinks stops at the cap instead of growing without bound', () => {
  const full = Array.from({ length: MAX_TASK_LINKS }, (_, i) =>
    link(`https://example.com/${i}`, { id: `l${i}` })
  );
  const result = mergeTaskLinks(full, [link('https://example.com/overflow', { id: 'x' })]);
  assert.strictEqual(result.links.length, MAX_TASK_LINKS);
  assert.deepStrictEqual(result.added, []);
});

test('extractTrackerLinks lifts tickets and PRs, and leaves the rest of the prose alone', () => {
  const text = [
    'Fix the crash from [WEB-1234 — Login loops](https://acme.atlassian.net/browse/WEB-1234).',
    'Follow up on https://github.com/acme/web/pull/9404 and read https://example.com/blog/post',
    'The docs at https://docs.google.com/document/d/abc explain it.'
  ].join('\n');

  assert.deepStrictEqual(extractTrackerLinks(text), [
    { url: 'https://acme.atlassian.net/browse/WEB-1234', title: 'WEB-1234 — Login loops' },
    { url: 'https://github.com/acme/web/pull/9404', title: undefined }
  ]);

  // The same ticket written twice is one link.
  assert.strictEqual(
    extractTrackerLinks('[a](https://acme.atlassian.net/browse/AB-1) https://acme.atlassian.net/browse/AB-1').length,
    1
  );
  assert.deepStrictEqual(extractTrackerLinks(''), []);
});

test('extractLinks lifts every URL a prompt carries, titled ones first', () => {
  const text = [
    'CI is red: https://github.com/acme/web/actions/runs/123/job/456.',
    'See [the thread](https://acme.slack.com/archives/C1/p2) and https://example.com/blog/post',
    'and again https://example.com/blog/post/'
  ].join('\n');
  assert.deepStrictEqual(extractLinks(text), [
    { url: 'https://acme.slack.com/archives/C1/p2', title: 'the thread' },
    { url: 'https://github.com/acme/web/actions/runs/123/job/456', title: undefined },
    { url: 'https://example.com/blog/post', title: undefined }
  ]);
});

test('classifyLink knows an Actions run, and the job inside one', () => {
  assert.deepStrictEqual(classifyLink('https://github.com/acme/web/actions/runs/123'), {
    kind: 'run',
    ref: 'acme/web run 123'
  });
  assert.deepStrictEqual(classifyLink('https://github.com/acme/web/actions/runs/123/job/456?pr=9'), {
    kind: 'run',
    ref: 'acme/web run 123 job 456'
  });
  // A workflow page is not a run.
  assert.strictEqual(classifyLink('https://github.com/acme/web/actions/workflows/ci.yml').kind, 'link');
});

test('sortTaskLinks and trackerLinks put the tracked work first', () => {
  const links = [
    link('https://example.com/notes', { id: 'n', createdAt: 1 }),
    link('https://github.com/acme/web/pull/9404', { id: 'p', createdAt: 3 }),
    link('https://acme.atlassian.net/browse/AB-1', { id: 'j', createdAt: 2 })
  ];
  assert.deepStrictEqual(sortTaskLinks(links).map((item) => item.id), ['j', 'p', 'n']);
  assert.deepStrictEqual(trackerLinks(links).map((item) => item.ref), ['AB-1', 'acme/web#9404']);
  assert.deepStrictEqual(trackerLinks(links, 1).map((item) => item.ref), ['AB-1']);
});

test('TaskStore lifts the ticket out of the prompt a task was created with', () => {
  const file = path.join(TEST_DATA_DIR, 'test_task_links.json');
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}.logs`, { recursive: true, force: true });
  const store = new TaskStore(file);

  const task = store.createTask({
    title: 'Login loops',
    prompt: 'Fix [WEB-1234](https://acme.atlassian.net/browse/WEB-1234)\n\n--- WEB-1234 description ---\nsee https://github.com/acme/other/pull/1\n--- end WEB-1234 description ---',
    description: 'Fix [WEB-1234](https://acme.atlassian.net/browse/WEB-1234)'
  });

  // Only the typed text is scanned: a fetched ticket body is reference material,
  // not a statement about what the task is.
  assert.deepStrictEqual(task.links?.map((item) => item.ref), ['WEB-1234']);
  assert.strictEqual(task.links?.[0]?.source, 'prompt');

  const added = store.addTaskLinks(task.id, [
    { url: 'https://github.com/acme/web/pull/9404', note: 'opened by this task' },
    { url: 'https://acme.atlassian.net/browse/WEB-1234' },
    { url: 'not a link' }
  ], 'agent');
  assert.ok(added);
  assert.deepStrictEqual(added.result.added.map((item) => item.ref), ['acme/web#9404']);
  assert.deepStrictEqual(added.rejected, ['not a link']);
  assert.strictEqual(added.task.links!.length, 2);

  const prId = added.result.added[0]!.id;
  const renamed = store.updateTaskLink(task.id, prId, { title: 'Rename the loop guard', note: '' });
  assert.strictEqual(renamed!.links![1]!.title, 'Rename the loop guard');
  assert.strictEqual(renamed!.links![1]!.note, undefined);
  assert.strictEqual(store.updateTaskLink(task.id, 'nope', { title: 'x' }), null);

  assert.strictEqual(store.deleteTaskLink(task.id, prId)!.links!.length, 1);
  assert.strictEqual(store.deleteTaskLink(task.id, prId), null);

  store.flush();
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}.logs`, { recursive: true, force: true });
});

test('a title that already opens with the ref does not print it twice', () => {
  const jira = buildTaskLink(
    { url: 'https://acme.atlassian.net/browse/AB-1', title: 'AB-1 — Login loops' },
    'l1'
  )!;
  assert.strictEqual(showRef(jira), false);
  assert.strictEqual(formatTaskLink(jira).split('\n')[0], '[l1] Jira — AB-1 — Login loops');

  const pr = buildTaskLink({ url: 'https://github.com/acme/web/pull/9404', title: 'Fix the loop' }, 'l2')!;
  assert.strictEqual(showRef(pr), true);
  assert.strictEqual(formatTaskLink(pr).split('\n')[0], '[l2] Pull request acme/web#9404 — Fix the loop');
});
