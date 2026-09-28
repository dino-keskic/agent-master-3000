import test from 'node:test';
import assert from 'node:assert';
import {
  initialQuestionValues,
  missingQuestionFields,
  questionAnswerContent
} from '../../../shared/agent/questionForm.js';
import { QuestionField } from '../../../shared/types.js';

const field = (over: Partial<QuestionField> & { name: string }): QuestionField => ({
  type: 'string',
  required: false,
  ...over
});

test('a question form starts from the schema', async (t) => {
  await t.test('each type gets an empty value of its own kind', () => {
    assert.deepEqual(
      initialQuestionValues([
        field({ name: 'branch' }),
        field({ name: 'force', type: 'boolean' }),
        field({ name: 'retries', type: 'integer' }),
        field({ name: 'paths', type: 'array' })
      ]),
      { branch: '', force: false, retries: '', paths: [] }
    );
  });

  await t.test('a default wins over the empty value, false included', () => {
    assert.deepEqual(
      initialQuestionValues([
        field({ name: 'force', type: 'boolean', default: false }),
        field({ name: 'retries', type: 'integer', default: 3 })
      ]),
      { force: false, retries: 3 }
    );
  });
});

test('only required fields can hold the answer back', async (t) => {
  const fields = [
    field({ name: 'branch', required: true }),
    field({ name: 'paths', type: 'array', required: true }),
    field({ name: 'note' })
  ];

  await t.test('blank text and an empty list are both unanswered', () => {
    assert.deepEqual(
      missingQuestionFields(fields, { branch: '   ', paths: [], note: '' }).map((f) => f.name),
      ['branch', 'paths']
    );
  });

  await t.test('an answered form has nothing missing', () => {
    assert.deepEqual(missingQuestionFields(fields, { branch: 'main', paths: ['a'], note: '' }), []);
  });

  await t.test('false is an answer to a required boolean', () => {
    assert.deepEqual(missingQuestionFields([field({ name: 'force', type: 'boolean', required: true })], { force: false }), []);
  });
});

test('what goes back to the agent', async (t) => {
  await t.test('numbers typed as text are sent as numbers', () => {
    assert.deepEqual(
      questionAnswerContent(
        [field({ name: 'retries', type: 'integer' }), field({ name: 'ratio', type: 'number' })],
        { retries: '3', ratio: '0.5' }
      ),
      { retries: 3, ratio: 0.5 }
    );
  });

  await t.test('an optional field left blank is left out', () => {
    assert.deepEqual(
      questionAnswerContent([field({ name: 'note' }), field({ name: 'branch', required: true })], {
        note: '',
        branch: 'main'
      }),
      { branch: 'main' }
    );
  });

  await t.test('a required field is sent even when it is empty', () => {
    assert.deepEqual(questionAnswerContent([field({ name: 'branch', required: true })], { branch: '' }), {
      branch: ''
    });
  });
});
