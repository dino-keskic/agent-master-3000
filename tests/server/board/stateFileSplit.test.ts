import test, { after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { BoardStateFile } from '../../../server/board/stateFile.js';

/**
 * Moving transcripts out of a board written before the split. The file being
 * migrated is the user's only copy of their board, so every way this can go
 * wrong has to leave it readable.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-master-3000-split-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const log = (text: string) => ({ id: `log-${text}`, type: 'agent_say', text, timestamp: 1 });
const inlineBoard = (name: string) => {
  const file = path.join(dir, `${name}.json`);
  const task = { id: 'TASK-1', title: 'a', columnId: 'todo', runState: 'idle', logs: [log('hello')] };
  fs.writeFileSync(file, JSON.stringify({ tasks: [task], settings: {}, nextTaskNumber: 1 }));
  return file;
};
const onDisk = (file: string) => JSON.parse(fs.readFileSync(file, 'utf-8'));

test('an inline board is split, and the original kept beside it', () => {
  const file = inlineBoard('split');
  const original = fs.readFileSync(file, 'utf-8');

  const state = new BoardStateFile(file).load();

  assert.deepStrictEqual(state.tasks[0]?.logs?.map((l) => l.text), ['hello']);
  assert.strictEqual(onDisk(file).tasks[0].logs, undefined);
  assert.strictEqual(fs.readFileSync(`${file}.pre-split`, 'utf-8'), original);
  assert.deepStrictEqual(new BoardStateFile(file).load().tasks[0]?.logs?.map((l) => l.text), ['hello']);
});

test('when the transcripts cannot be written, the document keeps them inline', () => {
  const file = inlineBoard('blocked');
  // A file where the transcript folder should be: mkdir fails.
  fs.writeFileSync(`${file}.logs`, '');

  new BoardStateFile(file).load();

  assert.deepStrictEqual(onDisk(file).tasks[0].logs.map((l: { text: string }) => l.text), ['hello']);
});

test('a document with no task list does not take the transcripts with it', () => {
  const file = inlineBoard('shapeless');
  new BoardStateFile(file).load();
  const transcripts = fs.readdirSync(`${file}.logs`);
  assert.strictEqual(transcripts.length, 1);

  fs.writeFileSync(file, JSON.stringify({ tasks: 'oops', settings: {} }));
  new BoardStateFile(file).load();

  assert.deepStrictEqual(fs.readdirSync(`${file}.logs`), transcripts);
});
