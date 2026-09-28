import test, { after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import {
  boardDocument,
  changedTranscripts,
  orphanedTranscripts,
  transcriptFileName,
  transcriptTaskId
} from '../../../shared/board/persistence.js';
import { applyLogToTask } from '../../../shared/task/logWrites.js';
import { BoardState, BoardTask, TaskLogItem } from '../../../shared/types.js';
import { TaskStore } from '../../../server/board/taskStore.js';
import { boardFile, legacyTask, writeBoardFile } from '../../fixtures/taskStore.js';

const log = (id: string, text = id): TaskLogItem => ({ id, timestamp: 1, type: 'info', title: 'i', text });
const task = (id: string, logs: TaskLogItem[] = []): BoardTask => ({ ...legacyTask(id, id, 'todo'), logs } as unknown as BoardTask);

test('the board document leaves transcripts out and the live state alone', () => {
  const live = task('TASK-1', [log('a')]);
  live.sessions = [{ sessionId: 's', logs: [log('b')] } as NonNullable<BoardTask['sessions']>[number]];
  const state = { tasks: [live], settings: {}, nextTaskNumber: 2 } as unknown as BoardState;

  const doc = boardDocument(state);
  assert.strictEqual('logs' in doc.tasks[0]!, false);
  assert.strictEqual(doc.tasks[0]!.sessions?.[0]?.logs?.length, 1, 'a session link keeps its own logs');
  assert.strictEqual(live.logs.length, 1);
});

test('only a transcript that changed since it was written is rewritten', () => {
  const quiet = task('TASK-1', [log('a')]);
  const busy = task('TASK-2', [log('b')]);
  const written = new Map([[quiet.id, [...quiet.logs]], [busy.id, [...busy.logs]]]);
  assert.deepStrictEqual(changedTranscripts([quiet, busy], written), []);

  applyLogToTask(busy, { ...log('b'), text: 'streamed more' });
  assert.deepStrictEqual(changedTranscripts([quiet, busy], written).map((t) => t.id), ['TASK-2']);

  written.set(busy.id, [...busy.logs]);
  busy.logs.push(log('c'));
  assert.deepStrictEqual(changedTranscripts([quiet, busy], written).map((t) => t.id), ['TASK-2']);
  assert.deepStrictEqual(changedTranscripts([task('TASK-3')], written).map((t) => t.id), ['TASK-3'], 'never written');
});

test('transcripts of tasks that left the board are orphans', () => {
  assert.deepStrictEqual(orphanedTranscripts([task('TASK-1')], ['TASK-1', 'TASK-9']), ['TASK-9']);
});

test('a task id never escapes the transcript folder, and round-trips', () => {
  assert.strictEqual(transcriptFileName('../../etc/passwd'), '..%2F..%2Fetc%2Fpasswd.json');
  assert.strictEqual(transcriptTaskId(transcriptFileName('TASK-7')), 'TASK-7');
  assert.strictEqual(transcriptTaskId('TASK-7.json.tmp'), null);
  assert.strictEqual(transcriptTaskId('%E0%A4%A.json'), null);
});

// --- on disk ---

const files: string[] = [];
after(() => files.forEach((file) => {
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}.logs`, { recursive: true, force: true });
}));

const transcriptOf = (file: string, taskId: string): TaskLogItem[] =>
  JSON.parse(fs.readFileSync(path.join(`${file}.logs`, transcriptFileName(taskId)), 'utf-8'));

test('a board with inline transcripts is split on load and reads back the same', () => {
  const file = writeBoardFile('persist_legacy', [
    { ...legacyTask('TASK-201', 'a', 'todo'), logs: [log('x', 'kept')] },
    legacyTask('TASK-202', 'b', 'todo')
  ], 203);
  files.push(file);

  const store = new TaskStore(file);
  assert.strictEqual(store.getTask('TASK-201')?.logs[0]?.text, 'kept');
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf-8'));
  assert.ok(onDisk.tasks.every((t: Record<string, unknown>) => !('logs' in t)), 'the document has no transcripts');
  assert.strictEqual(transcriptOf(file, 'TASK-201')[0]?.text, 'kept');

  const reloaded = new TaskStore(file);
  assert.strictEqual(reloaded.getTask('TASK-201')?.logs[0]?.text, 'kept');
  assert.deepStrictEqual(reloaded.getTask('TASK-202')?.logs, []);
});

test('a save rewrites the transcript that changed and no other', () => {
  const file = boardFile('persist_dirty');
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}.logs`, { recursive: true, force: true });
  files.push(file);

  const store = new TaskStore(file);
  const quiet = store.createTask({ title: 'quiet', prompt: 'p' });
  const busy = store.createTask({ title: 'busy', prompt: 'p' });
  store.flush();
  const quietFile = path.join(`${file}.logs`, transcriptFileName(quiet.id));
  const before = fs.statSync(quietFile).mtimeMs;
  fs.utimesSync(quietFile, new Date(0), new Date(0));

  store.addLogToTask(busy.id, log('streamed'));
  store.flush();
  assert.strictEqual(fs.statSync(quietFile).mtimeMs, 0, 'the quiet transcript was not rewritten');
  assert.ok(before > 0);
  assert.ok(transcriptOf(file, busy.id).some((l) => l.id === 'streamed'));
});

test('an archived-then-deleted task takes its transcript with it', () => {
  const file = boardFile('persist_delete');
  fs.rmSync(file, { force: true });
  files.push(file);

  const store = new TaskStore(file);
  const gone = store.createTask({ title: 'gone', prompt: 'p' });
  store.flush();
  const transcript = path.join(`${file}.logs`, transcriptFileName(gone.id));
  assert.ok(fs.existsSync(transcript));

  store.archiveTask(gone.id);
  store.deleteTask(gone.id);
  store.flush();
  assert.strictEqual(fs.existsSync(transcript), false);
});

test('a transcript that cannot be read is an empty log, kept aside, not a broken board', () => {
  const file = boardFile('persist_corrupt');
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}.logs`, { recursive: true, force: true });
  files.push(file);

  const store = new TaskStore(file);
  const hurt = store.createTask({ title: 'hurt', prompt: 'p' });
  store.addLogToTask(hurt.id, log('lost'));
  store.flush();
  fs.writeFileSync(path.join(`${file}.logs`, transcriptFileName(hurt.id)), '{"trunc');

  const reloaded = new TaskStore(file);
  assert.strictEqual(reloaded.getTask(hurt.id)?.title, 'hurt');
  assert.deepStrictEqual(reloaded.getTask(hurt.id)?.logs, []);
  assert.ok(fs.readdirSync(`${file}.logs`).some((name) => name.includes('.error-')), 'the unreadable copy is kept');
});

test('a burst of changes is one document write now and one when it settles', async () => {
  const file = boardFile('persist_burst');
  fs.rmSync(file, { force: true });
  files.push(file);

  const store = new TaskStore(file);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const first = store.createTask({ title: 'first', prompt: 'p' });
  const titleOnDisk = (id: string) =>
    JSON.parse(fs.readFileSync(file, 'utf-8')).tasks.find((t: BoardTask) => t.id === id)?.title;
  assert.strictEqual(titleOnDisk(first.id), 'first', 'a quiet file is written at once');

  const burst = Array.from({ length: 20 }, (_, i) => store.createTask({ title: `burst ${i}`, prompt: 'p' }));
  assert.strictEqual(titleOnDisk(burst.at(-1)!.id), undefined, 'the burst waits for the gap');
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.strictEqual(titleOnDisk(burst.at(-1)!.id), 'burst 19', 'and then lands whole');
});
