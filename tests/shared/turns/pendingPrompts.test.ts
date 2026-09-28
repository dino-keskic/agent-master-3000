import test from 'node:test';
import assert from 'node:assert';
import {
  pendingAsLog,
  pendingFor,
  pendingPrompt,
  settlePendingPrompts,
  streamActivity
} from '../../../shared/turns/pendingPrompts.js';
import { TaskLogItem } from '../../../shared/types.js';

let seq = 0;
function say(text: string, type: TaskLogItem['type'] = 'user_say'): TaskLogItem {
  seq += 1;
  return { id: `log-${seq}`, timestamp: seq, type, text, sessionId: 'ses_a' };
}

const base = { sessionId: 'ses_a', queued: [], runState: 'idle' as const };

test('a pending prompt waits for its echo, not for an earlier identical one', () => {
  const logs = [say('yes'), say('ok', 'agent_say')];
  const sent = [pendingPrompt('p1', ' yes ', undefined, { sessionId: 'ses_a', logs }, 100)];
  assert.strictEqual(sent[0]?.text, 'yes');
  assert.strictEqual(sent[0]?.echoesBefore, 1);

  // Nothing new: the very same array comes back, so a render-time adjust stops.
  assert.strictEqual(settlePendingPrompts(sent, { ...base, logs }), sent);
  assert.deepStrictEqual(settlePendingPrompts(sent, { ...base, logs: [...logs, say('yes')] }), []);
});

test('a prompt that lands in the queue is the queue’s to show', () => {
  const sent = [pendingPrompt('p1', 'next step', undefined, { sessionId: 'ses_a', logs: [] }, 100)];
  const queued = [{ id: 'q1', prompt: 'next step', queuedAt: 1 }];
  assert.deepStrictEqual(settlePendingPrompts(sent, { ...base, logs: [], queued }), []);
});

test('a run that ends without echoing the prompt drops it', () => {
  let pending = [pendingPrompt('p1', 'go', undefined, { sessionId: 'ses_a', logs: [] }, 100)];
  // Sent after a failure: the old error is not the end of this prompt's run.
  pending = settlePendingPrompts(pending, { ...base, logs: [], runState: 'error' });
  assert.strictEqual(pending.length, 1);
  pending = settlePendingPrompts(pending, { ...base, logs: [], runState: 'running' });
  assert.strictEqual(pending[0]?.started, true);
  pending = settlePendingPrompts(pending, { ...base, logs: [], runState: 'error' });
  assert.deepStrictEqual(pending, []);
});

test('only the observed session settles its prompts', () => {
  const other = pendingPrompt('p1', 'side question', undefined, { sessionId: 'ses_b', logs: [] }, 100);
  const early = pendingPrompt('p2', 'first', undefined, { sessionId: undefined, logs: [] }, 100);
  const pending = [other, early];
  const next = settlePendingPrompts(pending, { ...base, logs: [say('first')] });
  assert.deepStrictEqual(next, [other]);
  // A prompt sent before any session existed shows under whichever appears.
  assert.deepStrictEqual(pendingFor(pending, 'ses_a'), [early]);
  assert.deepStrictEqual(pendingFor(pending, 'ses_b'), [other, early]);
});

test('a pending prompt is drawn as the user message it will become', () => {
  const log = pendingAsLog(pendingPrompt('p1', 'hi', [], { sessionId: 'ses_a', logs: [] }, 100));
  assert.strictEqual(log.type, 'user_say');
  assert.strictEqual(log.text, 'hi');
  assert.strictEqual(log.images, undefined);
});

test('the transcript says warming up, then thinking, then nothing', () => {
  assert.strictEqual(streamActivity(1, 'idle', undefined), 'warming');
  assert.strictEqual(streamActivity(0, 'running', say('go')), 'thinking');
  assert.strictEqual(streamActivity(0, 'running', say('on it', 'agent_say')), undefined);
  assert.strictEqual(streamActivity(0, 'idle', say('go')), undefined);
});
