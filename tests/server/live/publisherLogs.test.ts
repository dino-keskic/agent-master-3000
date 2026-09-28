import test from 'node:test';
import assert from 'node:assert';
import { setTimeout as sleep } from 'timers/promises';
import { LiveHub } from '../../../server/live/hub.js';
import { Presenter } from '../../../server/live/presenter.js';
import { BoardPublisher } from '../../../server/live/publisher.js';
import { taskStore } from '../../../server/board/taskStore.js';
import { TurnRegistry } from '../../../server/turns/registry.js';
import { TaskLogItem, WebSocketMessage } from '../../../shared/types.js';

/** A hub that records what it would have sent, with one client attached. */
class RecordingHub extends LiveHub {
  readonly sent: Record<string, any>[] = [];
  constructor() { super(() => {}); }
  override hasClients(): boolean { return true; }
  override send(msg: WebSocketMessage): void { this.sendPayload(JSON.stringify(msg)); }
  override sendPayload(payload: string): void { this.sent.push(JSON.parse(payload)); }
}

const say = (id: string, text: string): TaskLogItem => ({ id, timestamp: Date.now(), type: 'agent_say', title: 'Agent', text });

test('a streamed message is pushed once per interval, as its latest text', async () => {
  const hub = new RecordingHub();
  const publisher = new BoardPublisher(hub, new Presenter(new TurnRegistry()));
  const task = taskStore.createTask({ title: 'stream', prompt: 'p' });

  let text = '';
  for (const word of ['one ', 'two ', 'three']) {
    text += word;
    publisher.log(task.id, say('m1', text));
  }
  assert.strictEqual(hub.sent.length, 0, 'nothing goes out per chunk');
  await sleep(150);

  assert.strictEqual(hub.sent.length, 1);
  assert.strictEqual(hub.sent[0]!.type, 'TASK_LOG');
  assert.strictEqual(hub.sent[0]!.log.text, 'one two three');
  assert.strictEqual(hub.sent[0]!.task.logsOmitted, true, 'the snapshot is still stripped');
});

test('any other push for the task sends its queued logs first', () => {
  const hub = new RecordingHub();
  const publisher = new BoardPublisher(hub, new Presenter(new TurnRegistry()));
  const task = taskStore.createTask({ title: 'order', prompt: 'p' });

  publisher.log(task.id, say('last-words', 'done.'));
  publisher.status(taskStore.getTask(task.id)!);
  assert.deepStrictEqual(hub.sent.map((m) => m.type), ['TASK_LOG', 'TASK_STATUS_CHANGED']);
});

test('what goes out is the stored line, clipped, not the raw update', async () => {
  const hub = new RecordingHub();
  const publisher = new BoardPublisher(hub, new Presenter(new TurnRegistry()));
  const task = taskStore.createTask({ title: 'clip', prompt: 'p' });

  publisher.log(task.id, say('huge', 'x'.repeat(50_000)));
  await sleep(150);
  assert.ok(hub.sent[0]!.log.text.length < 10_000);
});
