import test from 'node:test';
import assert from 'node:assert';
import { TurnQueue, queuedForSession, samePrompt, sameTurn } from '../../../shared/turns/queue.js';
import { PromptImage } from '../../../shared/composer/promptImages.js';

const shot = (id: string): PromptImage => ({ id, name: `${id}.png`, mimeType: 'image/png', size: 10 });

type Options = { columnId?: string };

function fill(queue: TurnQueue<Options>, key: string, prompts: string[], taskId = 'TASK-1') {
  return prompts.map((prompt) => queue.enqueue(key, { taskId, prompt, sessionId: key }));
}

test('queues follow-ups in the order they were typed', () => {
  const queue = new TurnQueue<Options>();
  fill(queue, 'ses_1', ['first', 'second', 'third']);

  assert.deepStrictEqual(
    queue.list('ses_1').map((turn) => turn.prompt),
    ['first', 'second', 'third']
  );
  assert.strictEqual(queue.size('ses_1'), 3);
});

test('drains oldest first, leaving the rest waiting', () => {
  const queue = new TurnQueue<Options>();
  fill(queue, 'ses_1', ['first', 'second', 'third']);

  assert.strictEqual(queue.shift('ses_1')?.prompt, 'first');
  assert.strictEqual(queue.shift('ses_1')?.prompt, 'second');
  assert.deepStrictEqual(queue.list('ses_1').map((turn) => turn.prompt), ['third']);
  assert.strictEqual(queue.shift('ses_1')?.prompt, 'third');
  assert.strictEqual(queue.shift('ses_1'), undefined);
});

test('carries the turn options through to the drain', () => {
  const queue = new TurnQueue<Options>();
  queue.enqueue('ses_1', { taskId: 'TASK-1', prompt: 'go', options: { columnId: 'review' } });

  assert.deepStrictEqual(queue.shift('ses_1')?.options, { columnId: 'review' });
});

test('ignores a prompt already waiting under the same key', () => {
  const queue = new TurnQueue<Options>();
  queue.enqueue('ses_1', { taskId: 'TASK-1', prompt: 'run the tests' });
  queue.enqueue('ses_1', { taskId: 'TASK-1', prompt: 'and lint' });

  assert.strictEqual(queue.enqueue('ses_1', { taskId: 'TASK-1', prompt: 'run the tests' }), undefined);
  assert.strictEqual(queue.size('ses_1'), 2);
});

test('the same prompt in another session is a different turn', () => {
  const queue = new TurnQueue<Options>();
  queue.enqueue('ses_1', { taskId: 'TASK-1', prompt: 'run the tests' });

  assert.ok(queue.enqueue('ses_2', { taskId: 'TASK-1', prompt: 'run the tests' }));
  assert.strictEqual(queue.size('ses_2'), 1);
});

test('removes one queued prompt by id and keeps the order of the rest', () => {
  const queue = new TurnQueue<Options>();
  const [, second] = fill(queue, 'ses_1', ['first', 'second', 'third']);

  assert.strictEqual(queue.remove(second!.id, 'TASK-1')?.prompt, 'second');
  assert.deepStrictEqual(queue.list('ses_1').map((turn) => turn.prompt), ['first', 'third']);
  assert.strictEqual(queue.remove(second!.id), undefined);
});

test('will not remove a queued prompt belonging to another task', () => {
  const queue = new TurnQueue<Options>();
  const entry = queue.enqueue('ses_1', { taskId: 'TASK-1', prompt: 'mine' });

  assert.strictEqual(queue.remove(entry!.id, 'TASK-2'), undefined);
  assert.strictEqual(queue.size('ses_1'), 1);
});

test('aggregates a task across its sessions and hides the server bookkeeping', () => {
  const queue = new TurnQueue<Options>();
  queue.enqueue('ses_1', { taskId: 'TASK-1', prompt: 'main follow-up', sessionId: 'ses_1', options: { columnId: 'x' } });
  queue.enqueue('ses_2', { taskId: 'TASK-1', prompt: 'fork follow-up', sessionId: 'ses_2' });
  queue.enqueue('ses_3', { taskId: 'TASK-2', prompt: 'other task' });

  const turns = queue.forTask('TASK-1');
  assert.deepStrictEqual(turns.map((turn) => turn.prompt), ['main follow-up', 'fork follow-up']);
  assert.deepStrictEqual(Object.keys(turns[0]!).sort(), ['id', 'prompt', 'queuedAt', 'sessionId']);
});

test('moves a queue onto the session the turn ended up creating', () => {
  const queue = new TurnQueue<Options>();
  fill(queue, 'new:TASK-1', ['first', 'second']);

  assert.strictEqual(queue.move('new:TASK-1', 'ses_9', 'ses_9'), 2);
  assert.strictEqual(queue.size('new:TASK-1'), 0);
  assert.deepStrictEqual(queue.list('ses_9').map((turn) => turn.prompt), ['first', 'second']);
  assert.deepStrictEqual(queue.list('ses_9').map((turn) => turn.sessionId), ['ses_9', 'ses_9']);
});

test('a moved queue lands behind what the target key already holds', () => {
  const queue = new TurnQueue<Options>();
  queue.enqueue('ses_9', { taskId: 'TASK-1', prompt: 'already there' });
  queue.enqueue('new:TASK-1', { taskId: 'TASK-1', prompt: 'typed during startup' });

  queue.move('new:TASK-1', 'ses_9', 'ses_9');
  assert.deepStrictEqual(
    queue.list('ses_9').map((turn) => turn.prompt),
    ['already there', 'typed during startup']
  );
});

test('stopping a session drops everything waiting on it, and nothing else', () => {
  const queue = new TurnQueue<Options>();
  fill(queue, 'ses_1', ['first', 'second']);
  queue.enqueue('ses_2', { taskId: 'TASK-1', prompt: 'fork' });

  assert.strictEqual(queue.clear('ses_1'), 2);
  assert.strictEqual(queue.size('ses_1'), 0);
  assert.strictEqual(queue.size('ses_2'), 1);
});

test('deleting a task drops its queues across every session', () => {
  const queue = new TurnQueue<Options>();
  queue.enqueue('ses_1', { taskId: 'TASK-1', prompt: 'a' });
  queue.enqueue('ses_2', { taskId: 'TASK-1', prompt: 'b' });
  queue.enqueue('ses_2', { taskId: 'TASK-2', prompt: 'c' });

  assert.strictEqual(queue.clearTask('TASK-1'), 2);
  assert.deepStrictEqual(queue.forTask('TASK-1'), []);
  assert.deepStrictEqual(queue.forTask('TASK-2').map((turn) => turn.prompt), ['c']);
});

test('a queued turn with no prompt of its own is still one entry', () => {
  const queue = new TurnQueue<Options>();
  assert.ok(queue.enqueue('ses_1', { taskId: 'TASK-1', options: { columnId: 'review' } }));
  assert.strictEqual(queue.enqueue('ses_1', { taskId: 'TASK-1', prompt: '' }), undefined);
  assert.strictEqual(queue.list('ses_1')[0]!.prompt, undefined);
});

test('samePrompt treats an absent prompt and an empty one as one turn', () => {
  assert.ok(samePrompt(undefined, ''));
  assert.ok(!samePrompt('go', ''));
});

test('the same words with different pictures are different turns', () => {
  assert.ok(sameTurn({ prompt: 'look' }, { prompt: 'look' }));
  assert.ok(sameTurn({ prompt: 'look', images: [shot('a')] }, { prompt: 'look', images: [shot('a')] }));
  assert.ok(!sameTurn({ prompt: 'look', images: [shot('a')] }, { prompt: 'look', images: [shot('b')] }));
  // Two image-only turns: without the images they would both look empty.
  assert.ok(!sameTurn({ images: [shot('a')] }, { images: [shot('b')] }));
});

test('a follow-up carrying different images is queued, not swallowed as a repeat', () => {
  const queue = new TurnQueue<Options>();
  assert.ok(queue.enqueue('ses_1', { taskId: 'TASK-1', prompt: 'fix this', images: [shot('a')] }));
  assert.strictEqual(queue.enqueue('ses_1', { taskId: 'TASK-1', prompt: 'fix this', images: [shot('a')] }), undefined);
  assert.ok(queue.enqueue('ses_1', { taskId: 'TASK-1', prompt: 'fix this', images: [shot('b')] }));
  assert.strictEqual(queue.size('ses_1'), 2);
});

test('the composer sees its own session, plus turns queued before one existed', () => {
  const task = {
    queued: [
      { id: 'a', prompt: 'before the session', queuedAt: 1 },
      { id: 'b', prompt: 'main', queuedAt: 2, sessionId: 'ses_1' },
      { id: 'c', prompt: 'fork', queuedAt: 3, sessionId: 'ses_2' }
    ]
  };

  assert.deepStrictEqual(
    queuedForSession(task, 'ses_1').map((turn) => turn.id),
    ['a', 'b']
  );
  assert.deepStrictEqual(queuedForSession(task, undefined).map((turn) => turn.id), ['a']);
  assert.deepStrictEqual(queuedForSession({}, 'ses_1'), []);
});

test('sending one now moves it to the front and keeps the rest in order', () => {
  const queue = new TurnQueue<Options>();
  const [, , third] = fill(queue, 'ses_1', ['first', 'second', 'third']);
  fill(queue, 'ses_2', ['elsewhere']);

  const promoted = queue.promote(third!.id, 'TASK-1');

  assert.strictEqual(promoted?.key, 'ses_1');
  assert.strictEqual(promoted?.entry.prompt, 'third');
  assert.deepStrictEqual(queue.list('ses_1').map((turn) => turn.prompt), ['third', 'first', 'second']);
  assert.deepStrictEqual(queue.list('ses_2').map((turn) => turn.prompt), ['elsewhere']);
});

test('sending one now refuses an id from another task, or one already gone', () => {
  const queue = new TurnQueue<Options>();
  const [first, second] = fill(queue, 'ses_1', ['first', 'second']);

  assert.strictEqual(queue.promote(second!.id, 'TASK-2'), undefined);
  assert.strictEqual(queue.promote('missing', 'TASK-1'), undefined);
  queue.shift('ses_1');
  assert.strictEqual(queue.promote(first!.id, 'TASK-1'), undefined);
  assert.deepStrictEqual(queue.list('ses_1').map((turn) => turn.prompt), ['second']);
});

test('the task\'s queue shows a prompt sent now first, as the card\'s next', () => {
  const queue = new TurnQueue<Options>();
  const [, urgent] = fill(queue, 'ses_1', ['first', 'urgent']);
  queue.promote(urgent!.id, 'TASK-1');

  assert.deepStrictEqual(queue.forTask('TASK-1').map((turn) => turn.prompt), ['urgent', 'first']);
});
