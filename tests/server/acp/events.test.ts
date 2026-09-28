import test from 'node:test';
import assert from 'node:assert';
import {
  compactFailed,
  compactFinished,
  promptEcho,
  promptEchoTitle,
  turnFailed,
  turnFinished,
  turnSuperseded
} from '../../../server/acp/events.js';

test('ACP event builders', async (t) => {
  await t.test('every event says which session it came from', () => {
    for (const event of [
      promptEcho('ses-1', 'User Prompt', 'go'),
      turnSuperseded('ses-1'),
      turnFinished('ses-1', 'end_turn'),
      turnFailed('ses-1', 'boom'),
      compactFinished('ses-1', 'end_turn'),
      compactFailed('ses-1', new Error('boom'))
    ]) {
      assert.strictEqual(event.sessionId, 'ses-1');
    }
  });

  await t.test('a superseded turn refreshes run state and says nothing', () => {
    const event = turnSuperseded('ses-1');
    assert.strictEqual(event.type, 'status_change');
    assert.strictEqual(event.log, undefined);
  });

  await t.test('a cancelled turn reads as stopped, not as finished work', () => {
    const cancelled = turnFinished('ses-1', 'cancelled');
    assert.strictEqual(cancelled.type, 'status_change');
    assert.match(cancelled.log?.title || '', /Cancelled/);
    assert.match(cancelled.log?.text || '', /Session kept/);

    const finished = turnFinished('ses-1', 'end_turn');
    assert.strictEqual(finished.log?.title, 'Turn Complete');
    // An unfamiliar stop reason is reported rather than dressed up as success.
    assert.match(turnFinished('ses-1', 'max_tokens').log?.text || '', /max_tokens/);
  });

  await t.test('a failed turn carries the error for the board and for the log', () => {
    const event = turnFailed('ses-1', 'agent exploded');
    assert.strictEqual(event.type, 'error');
    assert.strictEqual(event.error, 'agent exploded');
    assert.match(event.log?.text || '', /agent exploded/);
  });

  await t.test('a failed compact survives a thrown non-Error', () => {
    const fromError = compactFailed('ses-1', new Error('no session'));
    assert.strictEqual(fromError.error, 'no session');
    assert.match(fromError.log?.text || '', /no session/);

    // The error field stays undefined so the board supplies its own wording,
    // but the log line still has to say something.
    const fromString = compactFailed('ses-1', 'plain string');
    assert.strictEqual(fromString.error, undefined);
    assert.match(fromString.log?.text || '', /plain string/);
  });

  await t.test('the prompt echo is titled by what kind of turn it starts', () => {
    assert.strictEqual(promptEchoTitle(true, false, true), 'User Prompt');
    assert.strictEqual(promptEchoTitle(true, true, false), 'Side Chat (BTW)');
    assert.strictEqual(promptEchoTitle(false, false, true), 'User Prompt');
    // A bare continue of an existing session is not a new ask.
    assert.strictEqual(promptEchoTitle(false, false, false), 'Resume');
  });

  await t.test('the prompt echo is a user log line, not agent output', () => {
    const event = promptEcho('ses-1', 'User Prompt', 'ship it');
    assert.strictEqual(event.type, 'log');
    assert.strictEqual(event.log?.type, 'user_say');
    assert.strictEqual(event.log?.text, 'ship it');
    assert.strictEqual(event.log?.sessionId, 'ses-1');
    assert.ok(event.log?.id && event.log.timestamp);
  });
});
