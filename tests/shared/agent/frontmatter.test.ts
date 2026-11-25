import test from 'node:test';
import assert from 'node:assert';
import { parseFrontmatter, serializeFrontmatter } from '../../../shared/agent/frontmatter.js';

test('parses scalar, nested mapping, and list frontmatter fields', () => {
  const raw = [
    '---',
    'description: "Code reviewer: strict"',
    'mode: subagent',
    'temperature: 0.2',
    'hidden: true',
    'tools:',
    '  edit: false',
    '  "slack_*": false',
    '  read: true',
    'permission:',
    '  webfetch: deny',
    '  bash:',
    '    "*": ask',
    '    "git diff*": allow',
    '---',
    '',
    'You are a careful reviewer.',
    ''
  ].join('\n');

  const parsed = parseFrontmatter(raw);
  assert.strictEqual(parsed.hasFrontmatter, true);
  assert.strictEqual(parsed.data.description, 'Code reviewer: strict');
  assert.strictEqual(parsed.data.mode, 'subagent');
  assert.strictEqual(parsed.data.temperature, 0.2);
  assert.strictEqual(parsed.data.hidden, true);
  assert.deepStrictEqual(parsed.data.tools, { edit: false, 'slack_*': false, read: true });
  assert.deepStrictEqual(parsed.data.permission, {
    webfetch: 'deny',
    bash: { '*': 'ask', 'git diff*': 'allow' }
  });
  assert.strictEqual(parsed.body, 'You are a careful reviewer.\n');
});

test('parses OpenCode 2 array permissions and inline arrays', () => {
  const raw = [
    '---',
    'name: my-skill',
    'allowed-tools: [read, grep, glob]',
    'permissions:',
    '  - action: edit',
    '    resource: "*"',
    '    effect: deny',
    '  - action: shell',
    '    resource: "*"',
    '    effect: ask',
    '---',
    'Body text.'
  ].join('\n');

  const parsed = parseFrontmatter(raw);
  assert.deepStrictEqual(parsed.data['allowed-tools'], ['read', 'grep', 'glob']);
  assert.deepStrictEqual(parsed.data.permissions, [
    { action: 'edit', resource: '*', effect: 'deny' },
    { action: 'shell', resource: '*', effect: 'ask' }
  ]);
  assert.strictEqual(parsed.body, 'Body text.');
});

test('handles markdown without frontmatter', () => {
  const parsed = parseFrontmatter('# Hello\n\nJust prose.\n');
  assert.strictEqual(parsed.hasFrontmatter, false);
  assert.deepStrictEqual(parsed.data, {});
  assert.strictEqual(parsed.body, '# Hello\n\nJust prose.\n');
});

test('round-trips frontmatter cleanly in preferred key order', () => {
  const out = serializeFrontmatter(
    {
      custom_key: 'keep',
      tools: { webfetch: false, '*': true },
      description: 'Reads code: safely',
      mode: 'subagent'
    },
    'Inspect files only.',
    ['description', 'mode', 'tools']
  );

  const reparsed = parseFrontmatter(out);
  assert.strictEqual(reparsed.data.description, 'Reads code: safely');
  assert.strictEqual(reparsed.data.mode, 'subagent');
  assert.deepStrictEqual(reparsed.data.tools, { webfetch: false, '*': true });
  assert.strictEqual(reparsed.data.custom_key, 'keep');
  assert.strictEqual(reparsed.body, 'Inspect files only.\n');
  assert.ok(out.indexOf('description:') < out.indexOf('custom_key:'));
});
