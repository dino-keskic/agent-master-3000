import test from 'node:test';
import assert from 'node:assert';
import { ApprovalDesk, toolCallFromPermission, questionFieldsFrom } from '../../../server/acp/approvals.js';
import { PendingRequest } from '../../../shared/types.js';
import { elicitationParamsSchema, requestPermissionParamsSchema } from '../../../server/acp/schema.js';

const permission = (params: unknown) => requestPermissionParamsSchema.parse(params);
const elicitation = (params: unknown) => elicitationParamsSchema.parse(params);

test('toolCallFromPermission', async (t) => {
  await t.test('describes the tool call the agent is blocked on', () => {
    const toolCall = toolCallFromPermission(permission({
      sessionId: 'ses-1',
      toolCall: {
        toolCallId: 'call-1',
        title: 'bash',
        kind: 'execute',
        status: 'pending',
        rawInput: { command: 'rm -rf build' },
        locations: [{ path: '/repo/build' }, {}]
      },
      options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }]
    }));

    assert.strictEqual(toolCall.toolCallId, 'call-1');
    assert.strictEqual(toolCall.kind, 'execute');
    assert.strictEqual(toolCall.status, 'pending');
    assert.deepStrictEqual(toolCall.rawInput, { command: 'rm -rf build' });
    // Locations without a path carry nothing the board can show.
    assert.deepStrictEqual(toolCall.locations, ['/repo/build']);
  });

  await t.test('falls back to a pending status when the agent sends none', () => {
    const toolCall = toolCallFromPermission(permission({
      sessionId: 'ses-1',
      title: 'Write file',
      options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }]
    }));
    assert.strictEqual(toolCall.status, 'pending');
    // With no toolCall of its own, the session id is the only stable id there is.
    assert.strictEqual(toolCall.toolCallId, 'ses-1');
    assert.ok(toolCall.name);
  });

  await t.test('borrows the arguments an older OpenCode sent on the update instead', () => {
    // OpenCode 1.14: `rawInput: {}` on the request, the command on the
    // `in_progress` update that came just before it.
    const responses: unknown[] = [];
    const shown: PendingRequest[] = [];
    const desk = new ApprovalDesk({
      respond: (_id, result) => responses.push(result),
      emit: (_taskId, event) => { if (event.request) shown.push(event.request); },
      knownToolCall: (taskId, toolCallId) => taskId === 'task-1' && toolCallId === 'call-1'
        ? { toolCallId, name: 'bash', kind: 'execute', status: 'in_progress', rawInput: { command: 'echo hi' }, locations: ['/repo'] }
        : undefined
    });
    desk.onPermissionRequest(1, permission({
      sessionId: 'ses-1',
      toolCall: { toolCallId: 'call-1', title: 'bash', kind: 'execute', status: 'pending', rawInput: {}, locations: [] },
      options: [{ optionId: 'once', name: 'Allow once', kind: 'allow_once' }]
    }), 'task-1');

    const asked = shown[0];
    assert.strictEqual(asked?.type, 'permission');
    assert.deepStrictEqual(asked.toolCall.rawInput, { command: 'echo hi' });
    assert.deepStrictEqual(asked.toolCall.locations, ['/repo']);
    // Still the request's own status: it is waiting, whatever the update said.
    assert.strictEqual(asked.toolCall.status, 'pending');
    assert.deepStrictEqual(responses, []);
  });
});

test('questionFieldsFrom', async (t) => {
  await t.test('turns a requested schema into typed form fields', () => {
    const fields = questionFieldsFrom(elicitation({
      message: 'Which branch?',
      requestedSchema: {
        properties: {
          branch: { type: 'string', title: 'Branch', description: 'target', default: 'main' },
          force: { type: 'boolean' },
          env: { type: 'string', enum: ['dev', 'prod'] },
          tags: { type: 'array', items: { enum: ['a', 'b'] } }
        },
        required: ['branch']
      }
    }));

    assert.deepStrictEqual(fields.map((f) => f.name), ['branch', 'force', 'env', 'tags']);
    assert.deepStrictEqual(fields[0], {
      name: 'branch',
      type: 'string',
      title: 'Branch',
      description: 'target',
      required: true,
      options: undefined,
      default: 'main'
    });
    assert.strictEqual(fields[1]?.required, false);
    assert.deepStrictEqual(fields[2]?.options, ['dev', 'prod']);
    // An array field offers the choices its items declare.
    assert.deepStrictEqual(fields[3]?.options, ['a', 'b']);
  });

  await t.test('defaults an untyped field to a text box, and no schema to no fields', () => {
    const [field] = questionFieldsFrom(elicitation({
      message: 'Name?',
      requestedSchema: { properties: { name: {} } }
    }));
    assert.strictEqual(field?.type, 'string');
    assert.deepStrictEqual(questionFieldsFrom(elicitation({ message: 'Just tell me' })), []);
  });
});

test('ApprovalDesk', async (t) => {
  const request = (toolCallId: string) => permission({
    sessionId: 'ses-1',
    toolCall: { toolCallId, title: 'external_directory', kind: 'other', rawInput: { filepath: '/elsewhere' } },
    options: [
      { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'reject', name: 'Reject', kind: 'reject_once' }
    ]
  });

  const toolCallIdOf = (pending: PendingRequest | undefined) =>
    pending?.type === 'permission' ? pending.toolCall.toolCallId : undefined;

  const setup = () => {
    const responses: { id: unknown; result: unknown }[] = [];
    const shown: PendingRequest[] = [];
    const desk = new ApprovalDesk({
      respond: (id, result) => responses.push({ id, result }),
      emit: (_taskId, event) => { if (event.request) shown.push(event.request); }
    });
    desk.setMode('task-1', 'manual');
    return { desk, responses, shown };
  };

  await t.test('shows parallel requests one at a time, oldest first, so none is hidden', () => {
    const { desk, responses, shown } = setup();
    desk.onPermissionRequest(1, request('read'), 'task-1');
    desk.onPermissionRequest(2, request('grep'), 'task-1');

    // Announcing the grep would replace the read on screen and strand it. The
    // read is announced again instead, which costs nothing and puts a board
    // that lost the request right.
    assert.deepStrictEqual(shown.map(toolCallIdOf), ['read', 'read']);

    assert.ok(desk.resolve({ kind: 'permission', requestId: shown[0]!.requestId, optionId: 'once' }));
    const next = desk.requestFor('task-1', 'ses-1');
    assert.strictEqual(toolCallIdOf(next), 'grep');

    assert.ok(desk.resolve({ kind: 'permission', requestId: next!.requestId, optionId: 'once' }));
    assert.strictEqual(desk.requestFor('task-1', 'ses-1'), undefined);
    assert.deepStrictEqual(responses.map((r) => r.id), [1, 2]);
  });

  await t.test('keeps sessions apart', () => {
    const { desk, shown } = setup();
    desk.onPermissionRequest(1, request('read'), 'task-1');
    desk.onPermissionRequest(2, { ...request('fork-read'), sessionId: 'ses-2' }, 'task-1');
    // A fork's request is not queued behind the main session's.
    assert.deepStrictEqual(shown.map(toolCallIdOf), ['read', 'fork-read']);
  });

  await t.test('a request the agent abandoned does not swallow the next one', () => {
    const { desk, shown } = setup();
    desk.onPermissionRequest(1, request('read'), 'task-1');
    assert.strictEqual(toolCallIdOf(shown[0]), 'read');

    // The turn ended with the read still parked: nobody can answer it any more,
    // and leaving it at the head of the queue is what hid every later request.
    desk.cancelAll('task-1');
    desk.onPermissionRequest(2, request('grep'), 'task-1');

    assert.strictEqual(toolCallIdOf(shown[1]), 'grep');
    assert.strictEqual(toolCallIdOf(desk.requestFor('task-1', 'ses-1')), 'grep');
  });

  await t.test('drops what a dead agent was blocked on instead of answering it', () => {
    const { desk, responses, shown } = setup();
    desk.onPermissionRequest(1, request('read'), 'task-1');

    // The process exited: the id is gone, so there is nothing to answer.
    desk.dropAll();
    assert.strictEqual(responses.length, 0);
    assert.strictEqual(desk.requestFor('task-1'), undefined);

    // And the restarted agent's first request is shown, not queued behind it.
    desk.onPermissionRequest(2, request('grep'), 'task-1');
    assert.strictEqual(toolCallIdOf(shown[1]), 'grep');
  });
});
