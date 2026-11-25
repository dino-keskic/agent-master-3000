import { test } from 'node:test';
import assert from 'node:assert';
import { SESSION_TITLE_SOON_MS, SESSION_TITLE_WATCH_MS, awaitsSessionTitle } from '../../../shared/task/sessionTitles.js';

const NOW = 1_700_000_000_000;
const task = { sessionId: 'ses_main', title: 'Fix the login redirect', prompt: 'Fix the login redirect' };
const link = (title: string, sessionId = 'ses_main', updatedAt = NOW - 1_000) =>
  ({ sessionId, title, createdAt: updatedAt, updatedAt });

test('a main session still named after the prompt is waiting for its name', () => {
  assert.strictEqual(awaitsSessionTitle(task, link('Fix the login redirect'), NOW), true);
});

test('a session OpenCode has named is not checked again', () => {
  const named = { ...task, title: 'Login redirect fix' };
  assert.strictEqual(awaitsSessionTitle(named, link('Login redirect fix'), NOW), false);
});

test('a fork or fresh session with a stand-in title is waiting', () => {
  assert.strictEqual(awaitsSessionTitle(task, link('Session', 'ses_fork'), NOW), true);
  assert.strictEqual(awaitsSessionTitle(task, link('New session - 2026-09-29T10:00:00.000Z', 'ses_fork'), NOW), true);
});

test('a title the user typed is not a stand-in', () => {
  const typed = { ...task, title: 'Login bug', titleLocked: true };
  assert.strictEqual(awaitsSessionTitle(typed, link('Login bug'), NOW), false);
});

test('a session quiet for longer than the watch window is left alone', () => {
  const quiet = link('Session', 'ses_fork', NOW - SESSION_TITLE_WATCH_MS - 1);
  assert.strictEqual(awaitsSessionTitle(task, quiet, NOW), false);
});

test('a narrower window asks only about sessions active that recently', () => {
  const minutesAgo = link('Session', 'ses_fork', NOW - 2 * SESSION_TITLE_SOON_MS);
  assert.strictEqual(awaitsSessionTitle(task, minutesAgo, NOW), true);
  assert.strictEqual(awaitsSessionTitle(task, minutesAgo, NOW, SESSION_TITLE_SOON_MS), false);
});
