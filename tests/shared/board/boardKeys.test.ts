import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardKeyAction, isTypingTarget } from '../../../shared/board/boardKeys.js';

const idle = { typing: false, blocked: false, taskOpen: false };

test('j and k walk the tasks, Enter opens, n starts a new one', () => {
  assert.equal(boardKeyAction({ key: 'j' }, idle), 'next');
  assert.equal(boardKeyAction({ key: 'ArrowDown' }, idle), 'next');
  assert.equal(boardKeyAction({ key: 'k' }, idle), 'previous');
  assert.equal(boardKeyAction({ key: 'Enter' }, idle), 'open');
  assert.equal(boardKeyAction({ key: 'n' }, idle), 'new');
  assert.equal(boardKeyAction({ key: 'x' }, idle), undefined);
});

test('nothing fires while typing, except the new-task chord', () => {
  const typing = { ...idle, typing: true };
  assert.equal(boardKeyAction({ key: 'j' }, typing), undefined);
  assert.equal(boardKeyAction({ key: 'n' }, typing), undefined);
  assert.equal(boardKeyAction({ key: 'n', metaKey: true }, typing), 'new');
  assert.equal(boardKeyAction({ key: 'n', ctrlKey: true }, typing), 'new');
});

test('a panel over the board owns the keyboard', () => {
  const blocked = { ...idle, blocked: true };
  assert.equal(boardKeyAction({ key: 'j' }, blocked), undefined);
  assert.equal(boardKeyAction({ key: 'n', metaKey: true }, blocked), undefined);
});

test('modifiers leave the walk to the browser', () => {
  assert.equal(boardKeyAction({ key: 'j', metaKey: true }, idle), undefined);
  assert.equal(boardKeyAction({ key: 'k', altKey: true }, idle), undefined);
  assert.equal(boardKeyAction({ key: 'n', metaKey: true, shiftKey: true }, idle), undefined);
});

test('with a task open the walk still moves, but Enter is left alone', () => {
  const open = { ...idle, taskOpen: true };
  assert.equal(boardKeyAction({ key: 'j' }, open), 'next');
  assert.equal(boardKeyAction({ key: 'Enter' }, open), undefined);
});

test('fields and editable regions count as typing', () => {
  assert.equal(isTypingTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isTypingTarget({ tagName: 'DIV', role: 'combobox' }), true);
  assert.equal(isTypingTarget({ tagName: 'BUTTON' }), false);
  assert.equal(isTypingTarget({}), false);
});
