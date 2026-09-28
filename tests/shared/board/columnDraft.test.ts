import test from 'node:test';
import assert from 'node:assert';
import { BoardColumn } from '../../../shared/types.js';
import { columnRunsOnDrop } from '../../../shared/board/columns.js';
import {
  appendColumn,
  canSaveColumnDraft,
  cleanColumnDraft,
  columnSummaryLine,
  moveColumn,
  removeColumn
} from '../../../shared/board/columnDraft.js';

function column(id: string, extra: Partial<BoardColumn> = {}): BoardColumn {
  return { id, title: id, prompt: '', autoRun: false, ...extra };
}

test('columnDraft', async (t) => {
  await t.test('auto-run needs a prompt to mean anything', () => {
    assert.strictEqual(columnRunsOnDrop(column('a', { autoRun: true, prompt: 'go' })), true);
    assert.strictEqual(columnRunsOnDrop(column('a', { autoRun: true, prompt: '   ' })), false);
    assert.strictEqual(columnRunsOnDrop(column('a', { prompt: 'go' })), false);
  });

  await t.test('summarizes the count and the behaviours that are on', () => {
    assert.strictEqual(columnSummaryLine(column('a'), 1), '1 task');
    assert.strictEqual(columnSummaryLine(column('a'), 0), '0 tasks');
    assert.strictEqual(
      columnSummaryLine(
        column('a', { autoRun: true, prompt: 'go', compactOnEnter: true, newSessionOnEnter: true }),
        2
      ),
      '2 tasks · drop runs · compacts · fresh session'
    );
  });

  await t.test('moves a column one place, and stops at the ends', () => {
    const columns = [column('a'), column('b'), column('c')];
    assert.deepStrictEqual(moveColumn(columns, 1, -1).map((c) => c.id), ['b', 'a', 'c']);
    assert.deepStrictEqual(moveColumn(columns, 1, 1).map((c) => c.id), ['a', 'c', 'b']);
    assert.strictEqual(moveColumn(columns, 0, -1), columns);
    assert.strictEqual(moveColumn(columns, 2, 1), columns);
  });

  await t.test('removing selects the column above, and keeps the last one', () => {
    const columns = [column('a'), column('b'), column('c')];
    const middle = removeColumn(columns, 1);
    assert.deepStrictEqual(middle.columns.map((c) => c.id), ['a', 'c']);
    assert.strictEqual(middle.selectId, 'a');

    const first = removeColumn(columns, 0);
    assert.deepStrictEqual(first.columns.map((c) => c.id), ['b', 'c']);
    assert.strictEqual(first.selectId, 'b');

    const only = [column('a')];
    assert.strictEqual(removeColumn(only, 0).columns, only);
  });

  await t.test('adds a column without reusing an id', () => {
    const first = appendColumn([column('backlog')]);
    assert.strictEqual(first.id, 'new-column');
    const second = appendColumn(first.columns);
    assert.strictEqual(second.id, 'new-column-2');
    assert.deepStrictEqual(second.columns.map((c) => c.id), ['backlog', 'new-column', 'new-column-2']);
  });

  await t.test('cleans the draft on the way out', () => {
    const [cleaned] = cleanColumnDraft([
      column('a', {
        title: '  Review  ',
        prompt: '',
        autoRun: true,
        model: '',
        agent: '',
        thinkingLevel: '',
        compactOnEnter: false
      })
    ]);
    assert.strictEqual(cleaned?.title, 'Review');
    assert.strictEqual(cleaned?.autoRun, false);
    assert.strictEqual(cleaned?.model, undefined);
    assert.strictEqual(cleaned?.agent, undefined);
    assert.strictEqual(cleaned?.thinkingLevel, undefined);
    assert.strictEqual(cleaned?.compactOnEnter, undefined);

    const [untitled] = cleanColumnDraft([column('a', { title: '   ' })]);
    assert.strictEqual(untitled?.title, 'Untitled');
  });

  await t.test('a nameless column blocks saving', () => {
    assert.strictEqual(canSaveColumnDraft([column('a', { title: 'Backlog' })]), true);
    assert.strictEqual(canSaveColumnDraft([column('a', { title: ' ' })]), false);
    assert.strictEqual(canSaveColumnDraft([]), false);
  });
});
