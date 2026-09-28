import test from 'node:test';
import assert from 'node:assert';
import {
  ComposerMenuEntry,
  applyMenuEntry,
  composerMenuEntries,
  composerMenuHint,
  looksLikeTicket,
  moveMenuActive
} from '../../../shared/composer/menu.js';
import { FileItem, MentionItem } from '../../../shared/trackers/mentions.js';
import { SlashCommand } from '../../../shared/composer/slashCommands.js';
import { atTrigger, slashTrigger } from '../../../shared/composer/triggers.js';

const ticket: MentionItem = {
  kind: 'jira',
  id: 'WEB-53',
  title: 'Broken filter',
  url: 'https://example.atlassian.net/browse/WEB-53'
};

function file(path: string): FileItem {
  return { path, name: path.split('/').pop() || path };
}

function command(id: string, extra: Partial<SlashCommand> = {}): SlashCommand {
  return { id, label: id, description: `the ${id} command`, insert: `/${id} `, ...extra };
}

test('what the trigger menu offers', async (t) => {
  await t.test('`/` lists commands and nothing else', () => {
    const entries = composerMenuEntries({
      kind: 'slash',
      query: '',
      commands: [command('review')],
      files: [file('src/app.ts')],
      mentions: [ticket]
    });
    assert.deepStrictEqual(entries.map((e) => e.kind), ['command']);
  });

  await t.test('a plain `@` query is looking for a file', () => {
    const entries = composerMenuEntries({
      kind: 'at',
      query: 'app',
      commands: [],
      files: [file('src/app.ts')],
      mentions: [ticket]
    });
    assert.deepStrictEqual(entries.map((e) => e.kind), ['file', 'mention']);
  });

  await t.test('one shaped like a ticket key is not', () => {
    const entries = composerMenuEntries({
      kind: 'at',
      query: 'WEB-5',
      commands: [],
      files: [file('src/web-53.ts')],
      mentions: [ticket]
    });
    assert.deepStrictEqual(entries.map((e) => e.kind), ['mention', 'file']);
    assert.ok(looksLikeTicket('WEB-5'));
    assert.ok(looksLikeTicket('web-app#94'));
    assert.ok(!looksLikeTicket('src/App'));
  });

  await t.test('the file list is capped so the tickets stay reachable', () => {
    const entries = composerMenuEntries({
      kind: 'at',
      query: 'a',
      commands: [],
      files: Array.from({ length: 40 }, (_, i) => file(`src/f${i}.ts`)),
      mentions: [ticket],
      fileLimit: 3
    });
    assert.strictEqual(entries.filter((e) => e.kind === 'file').length, 3);
    assert.strictEqual(entries.filter((e) => e.kind === 'mention').length, 1);
  });

  await t.test('every row has an id of its own', () => {
    const entries = composerMenuEntries({
      kind: 'at',
      query: '',
      commands: [],
      files: [file('src/a.ts'), file('src/b.ts')],
      mentions: [ticket]
    });
    assert.strictEqual(new Set(entries.map((e) => e.id)).size, entries.length);
  });
});

test('picking a row', async (t) => {
  const text = 'look at @app';
  const trigger = atTrigger(text, text.length);
  assert.ok(trigger);

  await t.test('a file becomes its path', () => {
    const entry: ComposerMenuEntry = { kind: 'file', id: 'f', file: file('src/app.ts') };
    assert.deepStrictEqual(applyMenuEntry(entry, text, trigger, text.length), {
      text: 'look at @src/app.ts ',
      cursor: 20
    });
  });

  await t.test('a ticket becomes one link, and nothing of its body', () => {
    const entry: ComposerMenuEntry = { kind: 'mention', id: 'm', mention: ticket };
    const next = applyMenuEntry(entry, text, trigger, text.length);
    assert.ok(next);
    assert.strictEqual(next.text, `look at [WEB-53 — Broken filter](${ticket.url}) `);
    assert.strictEqual(next.cursor, next.text.length);
  });

  await t.test('a command inserts what it says it inserts', () => {
    const slash = slashTrigger('/rev', 4);
    assert.ok(slash);
    const entry: ComposerMenuEntry = { kind: 'command', id: 'c', command: command('review') };
    assert.deepStrictEqual(applyMenuEntry(entry, '/rev', slash, 4), { text: '/review ', cursor: 8 });
  });

  await t.test('a disabled command is listed to be seen, not run', () => {
    const slash = slashTrigger('/rev', 4);
    assert.ok(slash);
    const off: ComposerMenuEntry = {
      kind: 'command',
      id: 'c',
      command: command('review', { disabled: true, insert: '' })
    };
    assert.strictEqual(applyMenuEntry(off, '/rev', slash, 4), null);
  });
});

test('moving through the rows wraps at both ends', () => {
  assert.strictEqual(moveMenuActive(0, 3, 1), 1);
  assert.strictEqual(moveMenuActive(2, 3, 1), 0);
  assert.strictEqual(moveMenuActive(0, 3, -1), 2);
  // An empty menu has nowhere to move to.
  assert.strictEqual(moveMenuActive(0, 0, 1), 0);
});

test('an empty menu says what it was able to search', () => {
  assert.match(composerMenuHint('slash', true), /command or skill/);
  assert.match(composerMenuHint('at', true), /file/);
  assert.doesNotMatch(composerMenuHint('at', false), /file/);
});
