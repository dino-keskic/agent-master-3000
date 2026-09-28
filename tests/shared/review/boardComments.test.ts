import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { collectBoardComments, countBoardComments } from '../../../shared/review/boardComments.js';
import { BoardTask } from '../../../shared/types.js';

describe('boardComments', () => {
  it('collects comments across multiple tasks and classifies their status', () => {
    const tasks: Partial<BoardTask>[] = [
      {
        id: 'TASK-1',
        title: 'Task One',
        changelogComments: [
          {
            id: 'c1',
            path: 'src/main.ts',
            newLine: 42,
            side: 'add',
            author: 'user',
            body: 'Please check this line',
            snippet: 'const x = 1;',
            createdAt: 1000,
            replies: []
          },
          {
            id: 'c2',
            path: 'src/util.ts',
            side: 'add',
            author: 'user',
            body: 'Already handled',
            snippet: '',
            createdAt: 2000,
            resolvedAt: 2500,
            replies: []
          }
        ]
      },
      {
        id: 'TASK-2',
        title: 'Task Two',
        changelogComments: [
          {
            id: 'c3',
            path: 'src/config.ts',
            newLine: 10,
            side: 'add',
            author: 'agent',
            body: 'Done, agent replied',
            snippet: '',
            createdAt: 3000,
            replies: [
              {
                id: 'r1',
                author: 'user',
                body: 'Actually wait, fix again',
                createdAt: 3100
              }
            ]
          }
        ]
      }
    ];

    const comments = collectBoardComments(tasks as BoardTask[]);
    assert.equal(comments.length, 3);
    // Newest first: c3 (3000), c2 (2000), c1 (1000)
    assert.equal(comments[0]?.comment.id, 'c3');
    assert.equal(comments[0]?.status, 'waiting_agent');
    assert.equal(comments[1]?.comment.id, 'c2');
    assert.equal(comments[1]?.status, 'resolved');
    assert.equal(comments[2]?.comment.id, 'c1');
    assert.equal(comments[2]?.status, 'waiting_agent');

    const counts = countBoardComments(comments);
    assert.equal(counts.total, 3);
    assert.equal(counts.resolved, 1);
    assert.equal(counts.waitingAgent, 2);
    assert.equal(counts.open, 2);
  });
});
