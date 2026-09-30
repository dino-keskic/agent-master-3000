import test from 'node:test';
import assert from 'node:assert';
import {
  applyLinkStatuses,
  linksToRefresh,
  linkSettlement,
  linkStatusBadge,
  normalizeJiraStatus,
  normalizePrStatus,
  settlementLabel
} from '../../../shared/trackers/linkStatus.js';
import { buildTaskLink } from '../../../shared/task/links.js';
import { BoardTask, LinkStatus, TaskLink } from '../../../shared/types.js';

function link(url: string, status?: LinkStatus): TaskLink {
  const built = buildTaskLink({ url }, url, 'user', 1)!;
  if (status) built.status = status;
  return built;
}

const at = (state: LinkStatus['state'], label: string = state, checkedAt = 1_000): LinkStatus => ({ state, label, checkedAt });

test('normalizePrStatus treats a draft as still open and a close as not merged', () => {
  assert.deepStrictEqual(normalizePrStatus('MERGED'), { state: 'merged', label: 'Merged' });
  assert.deepStrictEqual(normalizePrStatus('OPEN', true), { state: 'draft', label: 'Draft' });
  assert.deepStrictEqual(normalizePrStatus('OPEN'), { state: 'open', label: 'Open' });
  assert.deepStrictEqual(normalizePrStatus('CLOSED'), { state: 'closed', label: 'Closed' });
  assert.equal(normalizePrStatus(''), null);
});

test('normalizeJiraStatus follows the category, not a hopeful reading of the name', () => {
  assert.deepStrictEqual(normalizeJiraStatus('Done', 'done'), { state: 'done', label: 'Done' });
  assert.deepStrictEqual(normalizeJiraStatus('In Review', 'indeterminate'), { state: 'open', label: 'In Review', stage: 'active' });
  assert.deepStrictEqual(normalizeJiraStatus('Selected', 'new'), { state: 'open', label: 'Selected', stage: 'todo' });
  assert.deepStrictEqual(normalizeJiraStatus('To Do'), { state: 'open', label: 'To Do', stage: 'todo' });
  assert.deepStrictEqual(normalizeJiraStatus('In Progress'), { state: 'open', label: 'In Progress', stage: 'active' });
  assert.deepStrictEqual(normalizeJiraStatus('Resolved'), { state: 'done', label: 'Resolved' });
  assert.equal(normalizeJiraStatus(undefined, undefined), null);
});

test('a task settles only when every linked PR is merged and every ticket is done', () => {
  const pr = 'https://github.com/acme/web/pull/1';
  const pr2 = 'https://github.com/acme/web/pull/2';
  const ticket = 'https://acme.atlassian.net/browse/WEB-1';

  assert.equal(linkSettlement([link(pr)]).settled, false);
  assert.equal(linkSettlement([link(pr, at('merged', 'Merged'))]).settled, true);
  assert.equal(settlementLabel(linkSettlement([link(pr, at('merged', 'Merged'))])), 'Merged');

  const mixed = linkSettlement([link(pr, at('merged', 'Merged')), link(pr2, at('open', 'Open'))]);
  assert.equal(mixed.settled, false);
  assert.equal(mixed.mergedCount, 1);

  assert.equal(linkSettlement([link(pr, at('closed', 'Closed'))]).settled, false);
  assert.equal(linkSettlement([link(ticket, at('done', 'Done'))]).settled, true);
  assert.equal(settlementLabel(linkSettlement([link(ticket, at('done', 'Done'))])), 'Done');

  const both = [
    link(pr, at('merged', 'Merged')),
    link(ticket, at('open', 'In Progress'))
  ];
  assert.equal(linkSettlement(both).settled, false);
  both[1] = link(ticket, at('done', 'Done'));
  const finished = linkSettlement(both);
  assert.equal(finished.settled, true);
  assert.equal(settlementLabel(finished), 'Merged · done');

});

test('linkStatusBadge prints a ticket\'s own words and only the unusual PR states', () => {
  const pr = 'https://github.com/acme/web/pull/1';
  const ticket = 'https://acme.atlassian.net/browse/WEB-1';
  assert.deepStrictEqual(linkStatusBadge(link(pr, at('draft', 'Draft'))), { text: 'draft', tone: 'todo' });
  assert.deepStrictEqual(linkStatusBadge(link(pr, at('merged', 'Merged'))), { text: 'merged', tone: 'done' });
  assert.deepStrictEqual(linkStatusBadge(link(pr, at('closed', 'Closed'))), { text: 'closed', tone: 'closed' });
  assert.equal(linkStatusBadge(link(pr, at('open', 'Open'))), undefined);
  assert.equal(linkStatusBadge(link(pr)), undefined);

  assert.deepStrictEqual(linkStatusBadge(link(ticket, { ...at('open', 'In Review'), stage: 'active' })), { text: 'In Review', tone: 'active' });
  assert.deepStrictEqual(linkStatusBadge(link(ticket, { ...at('open', 'Selected'), stage: 'todo' })), { text: 'Selected', tone: 'todo' });
  assert.deepStrictEqual(linkStatusBadge(link(ticket, at('done', 'Closed'))), { text: 'Closed', tone: 'done' });
  // Stored before the stage was: the name decides.
  assert.deepStrictEqual(linkStatusBadge(link(ticket, at('open', 'To Do'))), { text: 'To Do', tone: 'todo' });
  assert.deepStrictEqual(linkStatusBadge(link(ticket, at('open', 'In Progress'))), { text: 'In Progress', tone: 'active' });
});

test('linksToRefresh asks about unknown and open links first, and trusts a merge', () => {
  const now = 10_000;
  const pr = (n: number, status?: LinkStatus) => {
    const item = link(`https://github.com/acme/web/pull/${n}`, status);
    return { id: `T${n}`, links: [item], archivedAt: undefined } as BoardTask;
  };
  const targets = linksToRefresh(
    [
      pr(1, at('merged', 'Merged', now - 1_000)),
      pr(2, at('open', 'Open', now - 5_000)),
      pr(3),
      { ...pr(4), archivedAt: 1 }
    ],
    now,
    { openTtlMs: 2_000, quietTtlMs: 20_000, limit: 10 }
  );
  assert.deepStrictEqual(targets.map((item) => item.kind === 'pr' && item.number), [3, 2]);
});

test('applyLinkStatuses keeps a user title and skips a repaint when nothing moved', () => {
  const url = 'https://github.com/acme/web/pull/9';
  const task = { links: [link(url, at('open', 'Open'))], updatedAt: 1 } as BoardTask;
  task.links![0]!.title = 'The real title';
  const quiet = applyLinkStatuses(task, [{
    url,
    title: 'A different title from GitHub',
    status: at('open', 'Open', 5_000)
  }]);
  const stored = task.links?.[0];
  assert.ok(stored);
  assert.equal(quiet.visible, false);
  assert.equal(stored.title, 'The real title');
  assert.equal(stored.status?.checkedAt, 5_000);

  const seen = applyLinkStatuses(task, [{ url, status: at('merged', 'Merged', 6_000) }]);
  assert.equal(seen.visible, true);
  assert.equal(stored.status?.state, 'merged');
});

test('applyLinkStatuses never dates the task, so a status poll cannot fill "Updated today"', () => {
  const url = 'https://github.com/acme/web/pull/9';
  const task = { links: [link(url, at('open', 'Open'))], updatedAt: 1 } as BoardTask;
  applyLinkStatuses(task, [{ url, status: at('open', 'Open', 5_000) }]);
  applyLinkStatuses(task, [{ url, status: at('merged', 'Merged', 6_000) }]);
  assert.equal(task.updatedAt, 1);
});
