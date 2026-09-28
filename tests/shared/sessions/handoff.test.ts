import test from 'node:test';
import assert from 'node:assert';
import { handoffLog, sessionNeedsHandoff } from '../../../shared/sessions/handoff.js';

test('a session moved away from where OpenCode filed it is handed off', () => {
  assert.ok(sessionNeedsHandoff('/code/web-app.worktrees/fix', '/code/web-app'));
});

test('a session still where OpenCode filed it stays put', () => {
  assert.ok(!sessionNeedsHandoff('/code/web-app', '/code/web-app'));
  assert.ok(!sessionNeedsHandoff('/code/web-app/', '/code/web-app'));
});

test('nothing is handed off when either folder is unknown', () => {
  assert.ok(!sessionNeedsHandoff(undefined, '/code/web-app'));
  assert.ok(!sessionNeedsHandoff('/code/web-app', undefined));
  assert.ok(!sessionNeedsHandoff('', ''));
});

test('the log names both folders', () => {
  const log = handoffLog('Fix header', '/code/web-app', '/code/web-app.worktrees/fix');
  assert.match(log, /^Session "Fix header" continues in \/code\/web-app\.worktrees\/fix/);
  assert.match(log, /\(\/code\/web-app\)\.$/);
});
