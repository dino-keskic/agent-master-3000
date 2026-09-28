import test from 'node:test';
import assert from 'node:assert';
import { taskCardSummary } from '../../../shared/task/card.js';
import { link, permission, question, task } from '../../fixtures/boardTasks.js';

/** The card has one line for status and one strip for everything else. */

test('a blocked task says what it is blocked on', () => {
  const answer = taskCardSummary(task({ runState: 'awaiting_input', pendingRequest: question }));
  assert.strictEqual(answer.statusLabel, 'Needs an answer');
  assert.strictEqual(answer.waiting, true);

  const approval = taskCardSummary(task({ runState: 'awaiting_input', pendingRequest: permission }));
  assert.strictEqual(approval.statusLabel, 'Needs approval');
});

test('waiting outranks running, and running outranks a past error', () => {
  const waiting = taskCardSummary(
    task({ runState: 'awaiting_input', pendingRequest: permission, error: 'earlier failure' })
  );
  assert.strictEqual(waiting.statusLabel, 'Needs approval');

  const running = taskCardSummary(task({ runState: 'running', error: 'earlier failure' }));
  assert.strictEqual(running.statusLabel, 'Running');

  const failed = taskCardSummary(task({ runState: 'idle', error: 'it broke' }));
  assert.strictEqual(failed.statusLabel, 'Error');
  assert.strictEqual(failed.hasError, true);
});

test('several sessions running at once are counted', () => {
  const busy = taskCardSummary(
    task({
      runState: 'running',
      sessionId: 'a',
      sessions: [link({ sessionId: 'a', runState: 'running' }), link({ sessionId: 'b', runState: 'running' })]
    })
  );
  assert.strictEqual(busy.statusLabel, '2 running');
});

test('an idle task says nothing at all', () => {
  assert.strictEqual(taskCardSummary(task()).statusLabel, undefined);
});

test('the meta strip leads with spend and drops what is missing', () => {
  const summary = taskCardSummary(
    task({ cost: 1.25, contextTokens: 12_000, contextLimit: 100_000, updatedAt: Date.now(), projectName: 'board' })
  );
  assert.strictEqual(summary.meta[0], '$1.25');
  assert.strictEqual(summary.cost, '$1.25');
  assert.strictEqual(summary.place, 'board');
  assert.ok(!summary.meta.includes('board'));

  // Nothing to report but the timestamp.
  const bare = taskCardSummary(task({ updatedAt: Date.now(), projectName: undefined }));
  assert.deepEqual(bare.meta, ['just now']);
});

test('a missing folder keeps the project named, and is not something to run in', () => {
  const summary = taskCardSummary(task({ cwdExists: false, projectName: 'board', worktreeLabel: 'feature/x', updatedAt: Date.now() }));
  assert.strictEqual(summary.folderGone, true);
  assert.strictEqual(summary.place, 'board');
  const nameless = taskCardSummary(task({ cwdExists: false, projectName: undefined, updatedAt: Date.now() }));
  assert.strictEqual(nameless.place, 'folder gone');
});

test('the card names the project, never the worktree', () => {
  const summary = taskCardSummary(task({ projectName: 'acme-web', worktreeLabel: 'acme-web-feat-login-refactor · feat/login' }));
  assert.strictEqual(summary.place, 'acme-web');
  assert.ok(!summary.meta.some((part) => part.includes('feat/login')));
});

test('the whole-card link announces the status and the queue', () => {
  const summary = taskCardSummary(
    task({ id: 'TASK-9', title: 'Ship it', runState: 'running', queued: [{ id: 'q1', prompt: 'and this', queuedAt: 0 }] })
  );
  assert.strictEqual(summary.openLabel, 'TASK-9: Ship it · Running · 1 queued');
  assert.strictEqual(summary.queuedCount, 1);
});

test('a running card names the live tool and the next queued prompt', () => {
  const summary = taskCardSummary(
    task({
      runState: 'running',
      activeTools: [
        {
          toolCall: {
            toolCallId: 't1',
            name: 'bash',
            kind: 'execute',
            status: 'in_progress',
            rawInput: { command: 'yarn test', description: 'Wire the cap' }
          },
          startedAt: 1000
        }
      ],
      queued: [{ id: 'q1', prompt: 'Add the fallback test', queuedAt: 0 }]
    })
  );
  assert.deepEqual(summary.currentTool, {
    title: 'Wire the cap',
    command: 'yarn test',
    startedAt: 1000
  });
  assert.strictEqual(summary.nextPrompt, 'Add the fallback test');
});

test('a blocked permission card says what it wants to run', () => {
  const summary = taskCardSummary(task({ runState: 'awaiting_input', pendingRequest: permission }));
  assert.strictEqual(summary.waitingDetail, 'Wants to run: npm test');
});

test('an idle card has no live tool or waiting detail', () => {
  const summary = taskCardSummary(task());
  assert.strictEqual(summary.currentTool, undefined);
  assert.strictEqual(summary.nextPrompt, undefined);
  assert.strictEqual(summary.waitingDetail, undefined);
  assert.strictEqual(summary.openCommentsCount, 0);
});

test('counts open review comments and ignores resolved ones', () => {
  const summary = taskCardSummary(
    task({
      changelogComments: [
        {
          id: 'c1',
          path: 'src/main.ts',
          side: 'add',
          author: 'user',
          body: 'Check line',
          snippet: '',
          createdAt: 100,
          replies: []
        },
        {
          id: 'c2',
          path: 'src/util.ts',
          side: 'add',
          author: 'user',
          body: 'Done',
          snippet: '',
          createdAt: 200,
          resolvedAt: 250,
          replies: []
        }
      ]
    })
  );
  assert.strictEqual(summary.openCommentsCount, 1);
});

test('extracts todowrite plan onto running card tool', () => {
  const summary = taskCardSummary(
    task({
      runState: 'running',
      logs: [
        {
          id: 'l1',
          timestamp: 100,
          type: 'tool_call',
          text: 'Plan',
          toolCall: {
            toolCallId: 't-plan',
            name: 'todowrite',
            status: 'completed',
            rawInput: {
              todos: [
                { content: 'Step 1', status: 'completed' },
                { content: 'Step 2', status: 'in_progress' },
                { content: 'Step 3', status: 'pending' }
              ]
            }
          }
        }
      ],
      activeTools: [
        {
          toolCall: {
            toolCallId: 't1',
            name: 'bash',
            kind: 'execute',
            status: 'in_progress',
            rawInput: { command: 'yarn test', description: 'Run step 2 tests' }
          },
          startedAt: 1000
        }
      ]
    })
  );
  assert.strictEqual(summary.currentTool?.title, 'Step 2');
  assert.strictEqual(summary.currentTool?.stepBadge, '2/3');
  assert.strictEqual(summary.currentTool?.progressPercent, 33);
  assert.strictEqual(summary.currentTool?.command, 'yarn test');
});
