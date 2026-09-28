import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractTodoPlan, parseTodoRawInput } from '../../../shared/agent/todoPlan.js';
import { TaskLogItem } from '../../../shared/types.js';

describe('todoPlan', () => {
  it('parses an empty or non-object rawInput gracefully', () => {
    assert.equal(parseTodoRawInput(null), undefined);
    assert.equal(parseTodoRawInput(undefined), undefined);
    assert.equal(parseTodoRawInput({}), undefined);
    assert.equal(parseTodoRawInput({ todos: [] }), undefined);
  });

  it('parses a list of todos with mixed statuses and calculates progress', () => {
    const raw = {
      todos: [
        { content: 'Step 1: Setup test', status: 'completed', duration: '2m' },
        { content: 'Step 2: Trace logic', status: 'completed', duration: '1m' },
        { content: 'Step 3: Add limit table', status: 'completed', duration: '4m' },
        { content: 'Step 4: Wire validation', status: 'in_progress', meta: 'now' },
        { content: 'Step 5: Fallback test', status: 'pending' },
        { content: 'Step 6: Green E2E', status: 'pending' },
        { content: 'Step 7: Clean git state', status: 'blocked', meta: 'blocked' }
      ]
    };

    const plan = parseTodoRawInput(raw);
    assert.ok(plan);
    assert.equal(plan.totalCount, 7);
    assert.equal(plan.doneCount, 3);
    assert.equal(plan.runningCount, 1);
    assert.equal(plan.pendingCount, 2);
    assert.equal(plan.blockedCount, 1);
    assert.equal(plan.activeStepNumber, 4);
    assert.equal(plan.activeItem?.label, 'Step 4: Wire validation');
    assert.equal(plan.activeItem?.status, 'in_progress');
    assert.equal(plan.progressPercent, 43); // 3/7 = 42.8% -> 43%
  });

  it('handles boolean done fields and alternate key names', () => {
    const raw = {
      items: [
        { task: 'Initial commit', done: true },
        { title: 'Write tests', status: 'active' },
        { text: 'Deploy', status: 'pending' }
      ]
    };

    const plan = parseTodoRawInput(raw);
    assert.ok(plan);
    assert.equal(plan.totalCount, 3);
    assert.equal(plan.doneCount, 1);
    assert.equal(plan.runningCount, 1);
    assert.equal(plan.pendingCount, 1);
    assert.equal(plan.activeStepNumber, 2);
    assert.equal(plan.activeItem?.label, 'Write tests');
  });

  it('extracts latest todowrite from log history', () => {
    const logs: TaskLogItem[] = [
      {
        id: '1',
        timestamp: 1000,
        type: 'tool_call',
        text: 'Plan v1',
        toolCall: {
          toolCallId: 'c1',
          name: 'todowrite',
          status: 'completed',
          rawInput: {
            todos: [
              { content: 'Old item 1', status: 'pending' }
            ]
          }
        }
      },
      {
        id: '2',
        timestamp: 2000,
        type: 'thought',
        text: 'Some thoughts'
      },
      {
        id: '3',
        timestamp: 3000,
        type: 'tool_call',
        text: 'Plan v2',
        toolCall: {
          toolCallId: 'c2',
          name: 'todowrite',
          status: 'completed',
          rawInput: {
            todos: [
              { content: 'Task A', status: 'completed' },
              { content: 'Task B', status: 'in_progress' }
            ]
          }
        }
      }
    ];

    const plan = extractTodoPlan(logs);
    assert.ok(plan);
    assert.equal(plan.totalCount, 2);
    assert.equal(plan.doneCount, 1);
    assert.equal(plan.runningCount, 1);
    assert.equal(plan.activeItem?.label, 'Task B');
  });
});
