import test from 'node:test';
import assert from 'node:assert';
import {
  isIncomingJsonRpcRequest,
  jsonRpcMessageSchema,
  parseSessionUpdate,
  permissionToolCallFrom,
  requestPermissionParamsSchema,
  resolveConfigValue,
  type ConfigOption
} from '../../../server/acp/schema.js';

test('parseSessionUpdate', async (t) => {
  await t.test('reads a session_info_update title', () => {
    const { sessionId, parsed } = parseSessionUpdate({
      sessionId: 'ses_1',
      update: { sessionUpdate: 'session_info_update', title: 'Fix navbar overflow' }
    });
    assert.strictEqual(sessionId, 'ses_1');
    assert.deepStrictEqual(parsed, { kind: 'session_info', title: 'Fix navbar overflow' });
  });

  await t.test('still parses agent chunks', () => {
    const { parsed } = parseSessionUpdate({
      sessionId: 'ses_1',
      update: { sessionUpdate: 'agent_message_chunk', content: { text: 'hi' } }
    });
    assert.deepStrictEqual(parsed, { kind: 'agent_chunk', messageId: undefined, text: 'hi' });
  });
});

test('JSON-RPC incoming requests are distinct from responses that reuse an id', () => {
  const permission = jsonRpcMessageSchema.parse({
    jsonrpc: '2.0',
    id: 5,
    method: 'session/request_permission',
    params: { sessionId: 'ses_1' }
  });
  assert.strictEqual(isIncomingJsonRpcRequest(permission), true);

  const response = jsonRpcMessageSchema.parse({
    jsonrpc: '2.0',
    id: 5,
    result: { stopReason: 'end_turn' }
  });
  assert.strictEqual(isIncomingJsonRpcRequest(response), false);

  const stringId = jsonRpcMessageSchema.parse({
    jsonrpc: '2.0',
    id: 'req-5',
    method: 'session/request_permission',
    params: {}
  });
  assert.strictEqual(isIncomingJsonRpcRequest(stringId), true);
  assert.strictEqual(stringId.id, 'req-5');
});

test('permission params accept v1 toolCall and v2 title/subject', () => {
  const v1 = requestPermissionParamsSchema.parse({
    sessionId: 'ses_1',
    toolCall: {
      toolCallId: 'tc-1',
      title: 'bash',
      kind: 'execute',
      rawInput: { command: 'ls' }
    },
    options: [{ optionId: 'once', name: 'Allow once', kind: 'allow_once' }]
  });
  assert.strictEqual(permissionToolCallFrom(v1).toolCallId, 'tc-1');

  const v2 = requestPermissionParamsSchema.parse({
    sessionId: 'ses_1',
    title: 'Run a command',
    subject: {
      type: 'tool_call',
      toolCallId: 'tc-2',
      kind: 'execute',
      title: 'bash'
    },
    options: [{ optionId: 'reject', name: 'Reject', kind: 'reject_once' }]
  });
  assert.strictEqual(permissionToolCallFrom(v2).toolCallId, 'tc-2');
  assert.strictEqual(permissionToolCallFrom(v2).kind, 'execute');
});

test('resolveConfigValue matches Copilot provider prefixes and bare ids', () => {
  const options: ConfigOption[] = [
    {
      id: 'model',
      currentValue: 'github-copilot/claude-opus-5',
      options: [
        { value: 'github-copilot/kimi-k3', name: 'Kimi K3' },
        { value: 'github-copilot/claude-opus-5', name: 'Opus' },
        { value: 'github-copilot/grok-4.6', name: 'Grok' }
      ]
    }
  ];
  assert.strictEqual(resolveConfigValue(options, 'model', 'github-copilot/kimi-k3'), 'github-copilot/kimi-k3');
  assert.strictEqual(resolveConfigValue(options, 'model', 'kimi-k3'), 'github-copilot/kimi-k3');
  assert.strictEqual(resolveConfigValue(options, 'model', 'KIMI-K3'), 'github-copilot/kimi-k3');
  assert.strictEqual(resolveConfigValue(options, 'model', 'github-copilot/nope'), undefined);
  assert.strictEqual(resolveConfigValue([], 'model', 'github-copilot/kimi-k3'), 'github-copilot/kimi-k3');
});
