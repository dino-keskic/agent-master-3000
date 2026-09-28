import test from 'node:test';
import assert from 'node:assert';
import {
  SlashCommand,
  dedupeSlashCommands,
  filterSlashCommands,
  insertSlashCommand,
  leadingSlashCommand,
  slashTrigger,
  sortSlashCommands
} from '../../../shared/composer/slashCommands.js';
import { addressCommentsCommand } from '../../../shared/review/addressComments.js';

const commands: SlashCommand[] = [
  { id: 'address-comments', label: 'address comments', description: 'Attach open comments', kind: 'command', source: 'board', insert: 'Address these.' }
];

test('slashTrigger reads the /query token the caret is in', () => {
  assert.deepStrictEqual(slashTrigger('/addr', 5), { start: 0, query: 'addr' });
  assert.deepStrictEqual(slashTrigger('hello /ad', 9), { start: 6, query: 'ad' });
  assert.strictEqual(slashTrigger('src/foo', 7), null);
  assert.strictEqual(slashTrigger('/one two', 8), null);
});

test('insertSlashCommand replaces the /query token', () => {
  const trigger = slashTrigger('/addr', 5)!;
  const next = insertSlashCommand('/addr', trigger, 5, commands[0]!);
  assert.strictEqual(next.text, 'Address these.');
  assert.strictEqual(next.cursor, 'Address these.'.length);
});

test('filterSlashCommands matches spaced and dashed labels', () => {
  assert.strictEqual(filterSlashCommands(commands, 'address')[0]?.id, 'address-comments');
  assert.strictEqual(filterSlashCommands(commands, 'address-comments')[0]?.id, 'address-comments');
  assert.strictEqual(filterSlashCommands(commands, 'compact').length, 0);
});

test('board commands come first, then commands, then skills', () => {
  const sorted = sortSlashCommands([
    { id: 'g', label: 'zeta', description: '', kind: 'skill', source: 'global', insert: '/zeta ' },
    { id: 'p', label: 'review', description: '', kind: 'command', source: 'project', insert: '/review ' },
    { id: 'b', label: 'address comments', description: '', kind: 'command', source: 'board', insert: 'x' },
    { id: 'i', label: 'compact', description: '', kind: 'command', source: 'builtin', insert: '/compact ' }
  ]);
  assert.deepStrictEqual(sorted.map((c) => c.label), ['address comments', 'compact', 'review', 'zeta']);
});

test('dedupe keeps the first of a name but not a skill of the same name', () => {
  const rows = dedupeSlashCommands([
    { id: 'a', label: 'review', description: 'first', kind: 'command', source: 'project', insert: 'x' },
    { id: 'b', label: 'review', description: 'second', kind: 'command', source: 'global', insert: 'y' },
    { id: 'c', label: 'review', description: 'skill', kind: 'skill', source: 'global', insert: 'z' }
  ]);
  assert.deepStrictEqual(rows.map((r) => r.description), ['first', 'skill']);
});

test('address comments is disabled when there is nothing to address', () => {
  const empty = addressCommentsCommand([]);
  assert.ok(empty.disabled);
  assert.strictEqual(empty.source, 'board');
});

test('leadingSlashCommand finds the command a message starts with, and nothing else', () => {
  assert.deepStrictEqual(leadingSlashCommand('/review-pr 42 please'), { name: 'review-pr', rest: '42 please' });
  assert.deepStrictEqual(leadingSlashCommand('  /compact'), { name: 'compact', rest: '' });
  assert.deepStrictEqual(leadingSlashCommand('/frontend:design\nmake it calm'), { name: 'frontend:design', rest: '\nmake it calm' });
  assert.equal(leadingSlashCommand('/Users/me/app is broken'), null);
  assert.equal(leadingSlashCommand('run /compact later'), null);
  assert.equal(leadingSlashCommand('/ nothing'), null);
});
