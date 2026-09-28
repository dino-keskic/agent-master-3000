import test, { after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import { TaskStore } from '../../../server/board/taskStore.js';
import { legacyTask, writeBoardFile } from '../../fixtures/taskStore.js';

/** What the store makes of a board file an older version of it wrote. */

const written: string[] = [];
const board = (name: string, tasks: unknown[], nextTaskNumber: number) => {
  const file = writeBoardFile(name, tasks, nextTaskNumber);
  written.push(file);
  return new TaskStore(file);
};
after(() => written.forEach((file) => {
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}.logs`, { recursive: true, force: true });
}));

test('duplicate ids on disk are repaired on load', () => {
  const store = board(
    'dup',
    [legacyTask('TASK-101', 'seed', 'done', 1), legacyTask('TASK-101', 'user', 'todo', 2)],
    101
  );

  const ids = store.getTasks().map((t) => t.id);
  assert.strictEqual(new Set(ids).size, 2);
  assert.ok(ids.includes('TASK-101'));
  assert.ok(ids.some((id) => id !== 'TASK-101'));
});

test('legacy status columns migrate to columnId + runState', () => {
  const store = board(
    'migrate',
    [
      legacyTask('TASK-102', 'a', 'todo'),
      legacyTask('TASK-103', 'b', 'in_progress'),
      legacyTask('TASK-104', 'c', 'in_review'),
      legacyTask('TASK-105', 'd', 'done')
    ],
    110
  );

  const byId = Object.fromEntries(store.getTasks().map((t) => [t.id, t]));
  assert.strictEqual(byId['TASK-102']!.columnId, 'backlog');
  assert.strictEqual(byId['TASK-103']!.columnId, 'execute');
  assert.strictEqual(byId['TASK-104']!.columnId, 'deliver');
  assert.strictEqual(byId['TASK-105']!.columnId, 'deliver');
  assert.ok(store.getTasks().every((t) => t.runState === 'idle'));
  assert.ok(store.getTasks().every((t) => !('status' in t)));
  assert.ok(store.getSettings().columns.some((c) => c.id === 'plan'));
});

test('a session written before stage history gets it back from the move log', () => {
  // Exactly the shape TASK-194 was in: one session, started in Plan, carried
  // into Execute, and a breakdown that billed all of it to Plan.
  const store = board(
    'stagebackfill',
    [
      {
        ...legacyTask('TASK-194', 'Investigate', 'in_progress', 1000),
        columnId: 'execute',
        sessionId: 'ses_carried',
        sessions: [
          { sessionId: 'ses_carried', title: 'Investigate', kind: 'main', origin: 'initial', createdAt: 1000, stageColumnId: 'plan' }
        ],
        logs: [
          { id: 'l1', timestamp: 2000, type: 'status_change', title: 'Moved', text: 'Moved from Backlog to Plan.' },
          { id: 'l2', timestamp: 3000, type: 'status_change', title: 'Moved', text: 'Moved from Plan to Execute.' },
          { id: 'l3', timestamp: 3500, type: 'status_change', title: 'Project', text: 'Moved from one repo to another.' }
        ]
      }
    ],
    195
  );

  const link = store.getTask('TASK-194')?.sessions?.[0];
  assert.deepStrictEqual(
    link?.stages,
    [{ columnId: 'plan', at: 1000 }, { columnId: 'execute', at: 3000 }],
    'a project move is not a stage move, and the Backlog line predates the session'
  );
  assert.strictEqual(link?.stageColumnId, 'execute');
});

test('backfill leaves a session alone when no move log names a column it knows', () => {
  const store = board(
    'stagebackfill-unknown',
    [
      {
        ...legacyTask('TASK-1', 'Orphan', 'in_progress', 1000),
        columnId: 'plan',
        sessionId: 'ses_x',
        sessions: [{ sessionId: 'ses_x', title: 'x', kind: 'main', origin: 'initial', createdAt: 1000 }],
        logs: [
          { id: 'l1', timestamp: 2000, type: 'status_change', title: 'Moved', text: 'Moved from Plan to A Column Since Deleted.' }
        ]
      }
    ],
    2
  );

  // No stageColumnId to start from and no placeable move: nothing invented.
  assert.strictEqual(store.getTask('TASK-1')?.sessions?.[0]?.stages, undefined);
});

test('an archived session is not given a history it did not have', () => {
  const store = board(
    'stagebackfill-archived',
    [
      {
        ...legacyTask('TASK-2', 'Retired', 'in_progress', 1000),
        columnId: 'execute',
        sessions: [
          { sessionId: 'ses_done', title: 'Planning', kind: 'stage', origin: 'stage', createdAt: 1000, stageColumnId: 'plan', archivedAt: 2500 }
        ],
        logs: [
          { id: 'l1', timestamp: 3000, type: 'status_change', title: 'Moved', text: 'Moved from Plan to Execute.' }
        ]
      }
    ],
    3
  );

  const link = store.getTask('TASK-2')?.sessions?.[0];
  assert.strictEqual(link?.stages, undefined);
  assert.strictEqual(link?.stageColumnId, 'plan');
});
