import test from 'node:test';
import assert from 'node:assert';
import { pruneV1Parts, pruneV2Messages, trimV1Tail, trimV2Tail } from '../../../shared/sessions/pruneImages.js';

test('pruneV2Messages removes oldest user and tool images while preserving text and newest images', () => {
  const rows = [
    {
      id: 'm1',
      type: 'user',
      seq: 1,
      time_created: 1,
      time_updated: 1,
      data: JSON.stringify({
        text: 'Check these 3 shots',
        files: [
          { name: 'old-1.png', mime: 'image/png', data: 'aaa' },
          { name: 'old-2.png', mime: 'image/png', data: 'bbb' },
          { name: 'keep-3.png', mime: 'image/png', data: 'ccc' }
        ]
      })
    },
    {
      id: 'm2',
      type: 'assistant',
      seq: 2,
      time_created: 2,
      time_updated: 2,
      data: JSON.stringify({
        content: [
          { type: 'text', text: 'Inspecting page' },
          {
            type: 'tool',
            name: 'screenshot',
            id: 'call1',
            state: {
              status: 'completed',
              content: [
                { type: 'image', mimeType: 'image/png', data: 'ddd', name: 'tool-4.png' },
                { type: 'file', mime: 'image/webp', uri: 'data:image/webp;base64,eee', name: 'tool-5.webp' }
              ]
            }
          }
        ]
      })
    }
  ];

  const pruned = pruneV2Messages(rows, 3);
  assert.strictEqual(pruned.totalImages, 5);
  assert.strictEqual(pruned.removedImages, 2);
  assert.strictEqual(pruned.keptImages, 3);

  const m1 = JSON.parse(pruned.items[0]!.data);
  assert.strictEqual(m1.files.length, 1);
  assert.strictEqual(m1.files[0].name, 'keep-3.png');
  assert.ok(m1.text.includes('Check these 3 shots'));
  assert.ok(m1.text.includes('old-1.png'));
  assert.ok(m1.text.includes('old-2.png'));

  const prunedTight = pruneV2Messages(rows, 1);
  assert.strictEqual(prunedTight.removedImages, 4);
  assert.strictEqual(prunedTight.keptImages, 1);

  const m1Tight = JSON.parse(prunedTight.items[0]!.data);
  assert.strictEqual(m1Tight.files, undefined);

  const m2 = JSON.parse(prunedTight.items[1]!.data);
  const toolContent = m2.content[1].state.content;
  assert.strictEqual(toolContent[0].type, 'text');
  assert.ok(toolContent[0].text.includes('tool-4.png'));
  assert.strictEqual(toolContent[1].type, 'file');
  assert.strictEqual(toolContent[1].name, 'tool-5.webp');
});

test('pruneV1Parts strips oldest file and tool attachment images while preserving newest', () => {
  const parts = [
    {
      id: 'p1',
      message_id: 'm1',
      time_created: 1,
      time_updated: 1,
      data: JSON.stringify({ type: 'file', mime: 'image/png', filename: 'first.png', url: 'data:image/png;base64,111' })
    },
    {
      id: 'p2',
      message_id: 'm2',
      time_created: 2,
      time_updated: 2,
      data: JSON.stringify({
        type: 'tool',
        tool: 'browser',
        callID: 'c1',
        state: {
          status: 'completed',
          output: 'done',
          attachments: [
            { mime: 'image/png', filename: 'mid.png', url: 'data:image/png;base64,222' },
            { mime: 'image/png', filename: 'last.png', url: 'data:image/png;base64,333' }
          ]
        }
      })
    }
  ];

  const pruned = pruneV1Parts(parts, 1);
  assert.strictEqual(pruned.totalImages, 3);
  assert.strictEqual(pruned.removedImages, 2);
  assert.strictEqual(pruned.keptImages, 1);

  const p1 = JSON.parse(pruned.items[0]!.data);
  assert.strictEqual(p1.type, 'text');
  assert.ok(p1.text.includes('first.png'));

  const p2 = JSON.parse(pruned.items[1]!.data);
  assert.strictEqual(p2.state.attachments.length, 1);
  assert.strictEqual(p2.state.attachments[0].filename, 'last.png');
  assert.ok(p2.state.output.includes('mid.png'));
});

test('trimV2Tail and trimV1Tail remove current failed turn rows and image-limit error stubs', () => {
  const v2 = trimV2Tail(
    [
      { id: '1', type: 'user', seq: 1, time_created: 1000, time_updated: 1000, data: JSON.stringify({ text: 'Prior prompt' }) },
      { id: '2', type: 'assistant', seq: 2, time_created: 2000, time_updated: 2000, data: JSON.stringify({ error: { message: 'too many images: max 10, got 12' } }) },
      { id: '3', type: 'user', seq: 3, time_created: 5000, time_updated: 5000, data: JSON.stringify({ text: 'Retry prompt' }) }
    ],
    4500,
    'Retry prompt'
  );
  assert.deepStrictEqual(v2.map((r) => r.id), ['1']);

  const v1 = trimV1Tail(
    [
      { id: 'm1', time_created: 1000, data: JSON.stringify({ role: 'user' }) },
      { id: 'm2', time_created: 2000, data: JSON.stringify({ role: 'assistant', error: { data: { message: 'too many images' } } }) }
    ],
    undefined
  );
  assert.deepStrictEqual(v1.map((r) => r.id), ['m1']);
});
