import test from 'node:test';
import assert from 'node:assert';
import { boardOrigin, boardWindowUrl, linkTarget } from '../../../shared/desktop/window.js';

const ORIGIN = boardOrigin(3737);

test('the window opens the board, with a token link when the board has a token', () => {
  assert.equal(ORIGIN, 'http://127.0.0.1:3737');
  assert.equal(boardWindowUrl(ORIGIN, undefined), 'http://127.0.0.1:3737/');
  assert.equal(boardWindowUrl(ORIGIN, 'a b&c'), 'http://127.0.0.1:3737/?token=a+b%26c');
});

test('the window stays on the board; the web goes to the browser; anything else nowhere', () => {
  assert.equal(linkTarget('http://127.0.0.1:3737/?task=TASK-1', ORIGIN), 'board');
  assert.equal(linkTarget('http://localhost:3737/', ORIGIN), 'browser');
  assert.equal(linkTarget('https://github.com/o/r/pull/1', ORIGIN), 'browser');
  assert.equal(linkTarget('mailto:someone@example.com', ORIGIN), 'browser');
  assert.equal(linkTarget('file:///etc/passwd', ORIGIN), 'blocked');
  assert.equal(linkTarget('vscode://file/x', ORIGIN), 'blocked');
  assert.equal(linkTarget('not a url', ORIGIN), 'blocked');
});
