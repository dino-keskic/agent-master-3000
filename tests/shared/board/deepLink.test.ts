import test from 'node:test';
import assert from 'node:assert';
import { hrefWithTasks, taskIdsFromSearch } from '../../../shared/board/deepLink.js';

test('the ?task= deep link', async (t) => {
  await t.test('reads the task out of a query string', () => {
    assert.deepEqual(taskIdsFromSearch('?task=TASK-123'), ['TASK-123']);
    assert.deepEqual(taskIdsFromSearch('?task=TASK-123&other=1'), ['TASK-123']);
  });

  await t.test('reads a split view left to right, without repeats', () => {
    assert.deepEqual(taskIdsFromSearch('?task=TASK-1,TASK-2'), ['TASK-1', 'TASK-2']);
    assert.deepEqual(taskIdsFromSearch('?task=TASK-1%2CTASK-2,,TASK-1'), ['TASK-1', 'TASK-2']);
  });

  await t.test('has no task when the param is missing or empty', () => {
    assert.deepEqual(taskIdsFromSearch(''), []);
    assert.deepEqual(taskIdsFromSearch('?other=1'), []);
    assert.deepEqual(taskIdsFromSearch('?task='), []);
  });

  await t.test('writes the open task into the href', () => {
    assert.equal(
      hrefWithTasks('http://localhost:3999/', ['TASK-7']),
      'http://localhost:3999/?task=TASK-7'
    );
  });

  await t.test('writes a split view with a readable separator', () => {
    assert.equal(
      hrefWithTasks('http://localhost:3999/?view=grid', ['TASK-7', 'TASK-8']),
      'http://localhost:3999/?view=grid&task=TASK-7,TASK-8'
    );
  });

  await t.test('drops the param when nothing is open, keeping the rest', () => {
    assert.equal(
      hrefWithTasks('http://localhost:3999/?task=TASK-7&view=grid', []),
      'http://localhost:3999/?view=grid'
    );
  });

  await t.test('says nothing to do when the URL already agrees', () => {
    assert.equal(hrefWithTasks('http://localhost:3999/?task=TASK-7', ['TASK-7']), null);
    assert.equal(hrefWithTasks('http://localhost:3999/?task=TASK-7,TASK-8', ['TASK-7', 'TASK-8']), null);
    assert.equal(hrefWithTasks('http://localhost:3999/', []), null);
  });
});
