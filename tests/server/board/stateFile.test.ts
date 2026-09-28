import test from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { DEFAULT_FILE_PATH, defaultFilePath } from '../../../server/board/stateFile.js';

const REAL_BOARD = path.resolve(process.cwd(), 'data', 'board_state.json');

test('a test run never defaults to the real board file', () => {
  assert.ok(process.env.NODE_TEST_CONTEXT, 'node --test sets NODE_TEST_CONTEXT');
  assert.notStrictEqual(DEFAULT_FILE_PATH, REAL_BOARD);
  assert.notStrictEqual(defaultFilePath({ NODE_TEST_CONTEXT: 'child-v8' }), REAL_BOARD);
});

test('the server defaults to the real board file', () => {
  assert.strictEqual(defaultFilePath({}), REAL_BOARD);
});

test('BOARD_STATE_FILE wins, in tests and out', () => {
  assert.strictEqual(defaultFilePath({ BOARD_STATE_FILE: 'data/other.json' }), path.resolve(process.cwd(), 'data/other.json'));
  assert.strictEqual(
    defaultFilePath({ BOARD_STATE_FILE: 'data/other.json', NODE_TEST_CONTEXT: 'child-v8' }),
    path.resolve(process.cwd(), 'data/other.json')
  );
});
