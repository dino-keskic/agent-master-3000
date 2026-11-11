import test from 'node:test';
import assert from 'node:assert';
import {
  PALETTE_RECENT_LIMIT,
  PALETTE_TASK_LIMIT,
  PaletteCommand,
  PaletteSection,
  flattenSections,
  isPaletteChord,
  moveSelection,
  searchPalette,
  wordScore
} from '../../../shared/palette/search.js';
import { BoardColumn, TaskLink } from '../../../shared/types.js';
import { link, task } from '../../fixtures/boardTasks.js';

const columns = [
  { id: 'backlog', title: 'Backlog' },
  { id: 'execute', title: 'Execute' }
] as BoardColumn[];

const commands: PaletteCommand[] = [
  { id: 'spend', title: 'Open spend', keywords: 'cost money' },
  { id: 'theme', title: 'Switch theme', keywords: 'dark light' }
];

function ticket(ref: string, title = ref): TaskLink {
  return { id: ref, url: `https://example.atlassian.net/browse/${ref}`, title, kind: 'jira', ref, source: 'user', createdAt: 1 };
}

function ids(sections: PaletteSection[], label: string): string[] {
  return (sections.find((section) => section.label === label)?.results || []).map((result) => result.id);
}

test('a word matches best at the start of a word, and worse inside one', () => {
  assert.strictEqual(wordScore('web', 'WEB-1234'), 1);
  assert.strictEqual(wordScore('web', 'fix the web app'), 1);
  assert.strictEqual(wordScore('web', 'cobweb'), 0.6);
  assert.strictEqual(wordScore('web', 'web'), 1.5);
  assert.strictEqual(wordScore('web', 'mobile'), 0);
});

test('nothing typed lists what needs you first, then the most recent, then every command', () => {
  const tasks = [
    task({ id: 'T-1', updatedAt: 10 }),
    task({ id: 'T-2', updatedAt: 30 }),
    task({ id: 'T-3', updatedAt: 20, runState: 'awaiting_input' })
  ];
  const sections = searchPalette('  ', tasks, columns, commands);
  assert.deepStrictEqual(sections.map((section) => section.label), ['Recent tasks', 'Commands']);
  assert.deepStrictEqual(ids(sections, 'Recent tasks'), ['task:T-3', 'task:T-2', 'task:T-1']);
  assert.deepStrictEqual(ids(sections, 'Commands'), ['command:spend', 'command:theme']);
});

test('the resting list is capped, and archived tasks are never offered', () => {
  const many = Array.from({ length: PALETTE_RECENT_LIMIT + 4 }, (_, i) => task({ id: `T-${i}`, updatedAt: i }));
  assert.strictEqual(ids(searchPalette('', many, columns, []), 'Recent tasks').length, PALETTE_RECENT_LIMIT);

  const sections = searchPalette('ship', [task({ archivedAt: 5 })], columns, []);
  assert.deepStrictEqual(sections.map((section) => section.label), ['New']);
});

test('a task is found by its title, its ticket, its project and a session name', () => {
  const tasks = [
    task({ id: 'T-1', title: 'Login loops on Safari', links: [ticket('WEB-1234')] }),
    task({ id: 'T-2', title: 'Tidy the importer', projectName: 'billing-api' }),
    task({ id: 'T-3', title: 'Other', sessions: [link({ sessionId: 's', title: 'Flaky retry investigation' })] })
  ];
  const find = (query: string) => ids(searchPalette(query, tasks, columns, []), 'Tasks');
  assert.deepStrictEqual(find('safari'), ['task:T-1']);
  assert.deepStrictEqual(find('web-1234'), ['task:T-1']);
  assert.deepStrictEqual(find('billing'), ['task:T-2']);
  assert.deepStrictEqual(find('flaky'), ['task:T-3']);
  assert.deepStrictEqual(find('t-2'), ['task:T-2']);
});

test('every word has to match, though not in the same field', () => {
  const tasks = [task({ id: 'T-1', title: 'Login loops', projectName: 'web-app' })];
  assert.deepStrictEqual(ids(searchPalette('login web', tasks, columns, []), 'Tasks'), ['task:T-1']);
  assert.deepStrictEqual(ids(searchPalette('login mobile', tasks, columns, []), 'Tasks'), []);
});

test('a title hit outranks a mention in the prompt', () => {
  const tasks = [
    task({ id: 'T-1', title: 'Something else', prompt: 'mentions the importer in passing', updatedAt: 99 }),
    task({ id: 'T-2', title: 'Rewrite the importer', updatedAt: 1 })
  ];
  assert.deepStrictEqual(ids(searchPalette('importer', tasks, columns, []), 'Tasks'), ['task:T-2', 'task:T-1']);
});

test('matches are capped', () => {
  const many = Array.from({ length: PALETTE_TASK_LIMIT + 5 }, (_, i) => task({ id: `T-${i}` }));
  assert.strictEqual(ids(searchPalette('ship', many, columns, []), 'Tasks').length, PALETTE_TASK_LIMIT);
});

test('commands are found by their keywords too', () => {
  assert.deepStrictEqual(ids(searchPalette('cost', [], columns, commands), 'Commands'), ['command:spend']);
  assert.deepStrictEqual(ids(searchPalette('dark', [], columns, commands), 'Commands'), ['command:theme']);
});

test('a query always ends with the offer to create it, so Enter on a hit opens the hit', () => {
  const sections = searchPalette(' Ship  it ', [task()], columns, commands);
  const rows = flattenSections(sections);
  assert.strictEqual(rows[0]!.kind, 'task');
  assert.deepStrictEqual(rows[rows.length - 1], { kind: 'create', id: 'create', text: 'Ship  it' });

  const nothing = flattenSections(searchPalette('zzz', [task()], columns, commands));
  assert.deepStrictEqual(nothing.map((row) => row.kind), ['create']);
});

test('a row carries its column, its place and its refs once each', () => {
  const [section] = searchPalette('', [
    task({ worktreeLabel: 'web-1234-login', projectName: 'web-app', links: [ticket('WEB-1234'), { ...ticket('WEB-1234'), id: 'dup', url: 'https://x.example.com/browse/WEB-1234' }] })
  ], columns, []);
  const row = section!.results[0]!;
  assert.ok(row.kind === 'task');
  assert.strictEqual(row.task.columnTitle, 'Execute');
  assert.strictEqual(row.task.place, 'web-1234-login');
  assert.deepStrictEqual(row.task.refs, ['WEB-1234']);
});

test('the highlight wraps at both ends', () => {
  assert.strictEqual(moveSelection(0, -1, 4), 3);
  assert.strictEqual(moveSelection(3, 1, 4), 0);
  assert.strictEqual(moveSelection(1, 1, 4), 2);
  assert.strictEqual(moveSelection(2, 1, 0), 0);
});

test('the palette opens on ⌘K or ⌘P, and on nothing with another modifier', () => {
  const chord = (over: Partial<Parameters<typeof isPaletteChord>[0]>) =>
    isPaletteChord({ key: 'k', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over });
  assert.strictEqual(chord({ metaKey: true }), true);
  assert.strictEqual(chord({ ctrlKey: true, key: 'P' }), true);
  assert.strictEqual(chord({ metaKey: true, key: 'p' }), true);
  assert.strictEqual(chord({}), false);
  assert.strictEqual(chord({ metaKey: true, shiftKey: true }), false);
  assert.strictEqual(chord({ metaKey: true, key: 'j' }), false);
});
