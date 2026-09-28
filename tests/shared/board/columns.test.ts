import test from 'node:test';
import assert from 'node:assert';
import {
  interpolateColumnPrompt,
  resolveColumnId,
  resolveRunPrompt,
  sanitizeColumns,
  uniqueColumnId,
  unwrapStackedColumnPrompt,
  userTaskPrompt,
  columnEnterActions,
  DEFAULT_COLUMNS,
  LEGACY_STATUS_TO_COLUMN
} from '../../../shared/board/columns.js';

test('boardColumns helpers', async (t) => {
  await t.test('interpolates title and prompt placeholders', () => {
    const out = interpolateColumnPrompt('Plan {{title}}\n\n{{prompt}}', {
      title: 'Auth',
      prompt: 'Add JWT'
    });
    assert.strictEqual(out, 'Plan Auth\n\nAdd JWT');
  });

  await t.test('maps legacy statuses onto default columns', () => {
    const columns = DEFAULT_COLUMNS;
    assert.strictEqual(resolveColumnId(columns, undefined, 'todo'), 'backlog');
    assert.strictEqual(resolveColumnId(columns, undefined, 'in_progress'), 'execute');
    assert.strictEqual(resolveColumnId(columns, undefined, 'in_review'), 'deliver');
    assert.strictEqual(resolveColumnId(columns, undefined, 'done'), 'deliver');
    assert.strictEqual(LEGACY_STATUS_TO_COLUMN.todo, 'backlog');
  });

  await t.test('keeps a known columnId even when a legacy status is present', () => {
    assert.strictEqual(resolveColumnId(DEFAULT_COLUMNS, 'plan', 'todo'), 'plan');
  });

  await t.test('resolveRunPrompt prefers an explicit follow-up', () => {
    const column = DEFAULT_COLUMNS.find(c => c.id === 'plan')!;
    const task = { title: 'Auth', prompt: 'Add JWT' };
    assert.strictEqual(resolveRunPrompt(column, task, '  just this  '), 'just this');
    assert.ok(resolveRunPrompt(column, task)?.includes('Add JWT'));
    assert.strictEqual(resolveRunPrompt({ ...column, prompt: '' }, task), undefined);
  });

  await t.test('sanitizeColumns fills defaults and unique ids', () => {
    const cleaned = sanitizeColumns([
      { title: 'Plan', prompt: 'do it', autoRun: true },
      { id: 'plan', title: 'Also plan', prompt: '', autoRun: false }
    ]);
    assert.strictEqual(cleaned.length, 2);
    assert.strictEqual(cleaned[0]!.id, 'plan');
    assert.strictEqual(cleaned[1]!.id, 'plan-2');
    assert.deepStrictEqual(sanitizeColumns([]).map(c => c.id), DEFAULT_COLUMNS.map(c => c.id));
  });

  await t.test('sanitizeColumns keeps compactOnEnter only when it is truthy', () => {
    const cleaned = sanitizeColumns([
      { id: 'plan', title: 'Plan', prompt: 'do it', autoRun: true, compactOnEnter: true },
      { id: 'execute', title: 'Execute', prompt: 'go', autoRun: true, compactOnEnter: false },
      { id: 'deliver', title: 'Deliver', prompt: 'check', autoRun: false }
    ]);
    assert.strictEqual(cleaned[0]!.compactOnEnter, true);
    assert.strictEqual(cleaned[1]!.compactOnEnter, undefined);
    assert.strictEqual(cleaned[2]!.compactOnEnter, undefined);
  });

  await t.test('sanitizeColumns coerces a non-boolean compactOnEnter', () => {
    const cleaned = sanitizeColumns([
      { id: 'plan', title: 'Plan', prompt: '', autoRun: false, compactOnEnter: 'yes' },
      { id: 'execute', title: 'Execute', prompt: '', autoRun: false, compactOnEnter: 0 }
    ]);
    assert.strictEqual(cleaned[0]!.compactOnEnter, true);
    assert.strictEqual(cleaned[1]!.compactOnEnter, undefined);
  });

  await t.test('compactOnEnter survives a sanitize round-trip', () => {
    const once = sanitizeColumns([{ id: 'deliver', title: 'Deliver', prompt: 'p', autoRun: true, compactOnEnter: true }]);
    const twice = sanitizeColumns(JSON.parse(JSON.stringify(once)));
    assert.deepStrictEqual(twice, once);
    assert.strictEqual(twice[0]!.compactOnEnter, true);
  });

  await t.test('default columns do not compact on enter', () => {
    assert.ok(DEFAULT_COLUMNS.every((column) => !column.compactOnEnter));
    assert.ok(sanitizeColumns([]).every((column) => !column.compactOnEnter));
  });

  await t.test('sanitizeColumns preserves and coerces newSessionOnEnter', () => {
    const cleaned = sanitizeColumns([
      { id: 'plan', title: 'Plan', prompt: 'do it', autoRun: true, newSessionOnEnter: true },
      { id: 'execute', title: 'Execute', prompt: 'go', autoRun: true, newSessionOnEnter: false },
      { id: 'review', title: 'Review', prompt: 'check', autoRun: false, newSessionOnEnter: 'yes' as unknown as boolean },
      { id: 'deliver', title: 'Deliver', prompt: 'ship', autoRun: false }
    ]);
    assert.strictEqual(cleaned[0]!.newSessionOnEnter, true);
    assert.strictEqual(cleaned[1]!.newSessionOnEnter, undefined);
    assert.strictEqual(cleaned[2]!.newSessionOnEnter, true);
    assert.strictEqual(cleaned[3]!.newSessionOnEnter, undefined);
  });

  await t.test('newSessionOnEnter survives a sanitize round-trip', () => {
    const once = sanitizeColumns([{ id: 'plan', title: 'Plan', prompt: 'p', autoRun: true, newSessionOnEnter: true }]);
    const twice = sanitizeColumns(JSON.parse(JSON.stringify(once)));
    assert.deepStrictEqual(twice, once);
    assert.strictEqual(twice[0]!.newSessionOnEnter, true);
  });

  await t.test('uniqueColumnId increments', () => {
    assert.strictEqual(uniqueColumnId('Execute', ['execute']), 'execute-2');
    assert.strictEqual(uniqueColumnId('Execute', ['execute', 'execute-2']), 'execute-3');
  });

  await t.test('unwrapStackedColumnPrompt recovers the original user request', () => {
    const stacked = [
      'Implement this task. Follow any plan already in this conversation.',
      'Make the code changes, then summarize what you did.',
      '',
      'Task: Implementation plan for WEB-5314 task',
      '',
      'Read the repository and produce a concise implementation plan for this task.',
      'Do not write or edit code yet. List the files you would change, the approach, and any risks.',
      '',
      'Task: https://acme.atlassian.net/browse/WEB-5314 implement this',
      '',
      'https://acme.atlassian.net/browse/WEB-5314 implement this'
    ].join('\n');
    assert.strictEqual(
      unwrapStackedColumnPrompt(stacked),
      'https://acme.atlassian.net/browse/WEB-5314 implement this'
    );
  });

  await t.test('execute interpolation does not nest a previous plan prompt', () => {
    const execute = DEFAULT_COLUMNS.find(c => c.id === 'execute')!;
    const task = {
      title: 'Implementation plan for WEB-5314 task',
      prompt: [
        'Read the repository and produce a concise implementation plan for this task.',
        'Do not write or edit code yet. List the files you would change, the approach, and any risks.',
        '',
        'Task: https://acme.atlassian.net/browse/WEB-5314 implement this',
        '',
        'https://acme.atlassian.net/browse/WEB-5314 implement this'
      ].join('\n'),
      originalPrompt: 'https://acme.atlassian.net/browse/WEB-5314 implement this'
    };
    const sent = resolveRunPrompt(execute, task)!;
    assert.ok(!sent.includes('Read the repository and produce a concise implementation plan'));
    assert.ok(!sent.includes('Task: Implementation plan'));
    assert.strictEqual(userTaskPrompt(task), 'https://acme.atlassian.net/browse/WEB-5314 implement this');
  });

  await t.test('sanitizeColumns upgrades legacy default column prompts', () => {
    const cleaned = sanitizeColumns([
      {
        id: 'execute',
        title: 'Execute',
        autoRun: true,
        prompt: [
          'Implement this task. Follow any plan already in this conversation.',
          'Make the code changes, then summarize what you did.',
          '',
          'Task: {{title}}',
          '',
          '{{prompt}}'
        ].join('\n')
      }
    ]);
    assert.ok(!cleaned[0]!.prompt.includes('{{title}}'));
    assert.ok(!cleaned[0]!.prompt.includes('{{prompt}}'));
  });

  await t.test('columnEnterActions skip on-enter work while a turn is running', () => {
    const execute = DEFAULT_COLUMNS.find((c) => c.id === 'execute')!;
    const idle = columnEnterActions(execute, {
      sameColumn: false,
      alreadyRan: false,
      busy: false,
      hasSession: true
    });
    assert.deepStrictEqual(idle, { autoRun: true, compact: false, newSession: false });

    const running = columnEnterActions(execute, {
      sameColumn: false,
      alreadyRan: false,
      busy: true,
      hasSession: true
    });
    assert.deepStrictEqual(running, { autoRun: false, compact: false, newSession: false });

    const interrupt = columnEnterActions(
      { ...execute, compactOnEnter: true, newSessionOnEnter: true },
      { sameColumn: false, alreadyRan: false, busy: false, hasSession: true }
    );
    assert.deepStrictEqual(interrupt, { autoRun: true, compact: false, newSession: true });
  });
});
