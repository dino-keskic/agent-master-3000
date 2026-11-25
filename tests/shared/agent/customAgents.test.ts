import test from 'node:test';
import assert from 'node:assert';
import {
  cleanPermissionConflict,
  filterCustomAgents,
  groupCustomAgents,
  isValidAgentId,
  parseAgentMarkdown,
  resolveAgentToolInventory,
  serializeAgentMarkdown,
  setAgentToolRule,
  slugifyAgentId
} from '../../../shared/agent/customAgents.js';
import { SessionToolInventory } from '../../../shared/agent/tools.js';

test('isValidAgentId and slugifyAgentId validate agent paths safely', () => {
  assert.ok(isValidAgentId('code-reviewer'));
  assert.ok(isValidAgentId('team/reviewer'));
  assert.ok(!isValidAgentId(''));
  assert.ok(!isValidAgentId('../escape'));
  assert.ok(!isValidAgentId('/leading'));
  assert.ok(!isValidAgentId('has space'));
  assert.strictEqual(slugifyAgentId('My Code Reviewer!'), 'my-code-reviewer');
});

test('parseAgentMarkdown and serializeAgentMarkdown round-trip fields and tools', () => {
  const raw = [
    '---',
    'description: Reviews PRs without editing',
    'mode: subagent',
    'model: anthropic/claude-sonnet-4-5',
    'temperature: 0.2',
    'steps: 12',
    'tools:',
    '  edit: false',
    '  write: false',
    'custom_flag: keep-me',
    '---',
    '',
    'You are a strict reviewer.',
    ''
  ].join('\n');

  const parsed = parseAgentMarkdown(raw, {
    id: 'reviewer',
    scope: 'project',
    filePath: '/repo/.opencode/agents/reviewer.md',
    locationLabel: '.opencode/agents'
  });

  assert.strictEqual(parsed.id, 'reviewer');
  assert.strictEqual(parsed.description, 'Reviews PRs without editing');
  assert.strictEqual(parsed.mode, 'subagent');
  assert.strictEqual(parsed.model, 'anthropic/claude-sonnet-4-5');
  assert.strictEqual(parsed.temperature, 0.2);
  assert.strictEqual(parsed.steps, 12);
  assert.deepStrictEqual(parsed.tools, { edit: false, write: false });
  assert.strictEqual(parsed.prompt, 'You are a strict reviewer.\n');
  assert.strictEqual(parsed.extraFrontmatter?.custom_flag, 'keep-me');

  const out = serializeAgentMarkdown(parsed);
  const again = parseAgentMarkdown(out, {
    id: 'reviewer',
    scope: 'project',
    filePath: '/repo/.opencode/agents/reviewer.md',
    locationLabel: '.opencode/agents'
  });
  assert.strictEqual(again.description, parsed.description);
  assert.deepStrictEqual(again.tools, { edit: false, write: false });
  assert.strictEqual(again.extraFrontmatter?.custom_flag, 'keep-me');
});

test('setAgentToolRule keeps maps minimal and supports allow-list wildcards', () => {
  // Enabling a tool when default is on removes the redundant `true` entry.
  assert.deepStrictEqual(setAgentToolRule({ webfetch: false }, 'webfetch', true), {});
  // Under `* : false`, enabling `read` adds `read: true`, and disabling it again drops `read`.
  const allowList = setAgentToolRule({ '*': false }, 'read', true);
  assert.deepStrictEqual(allowList, { '*': false, read: true });
  assert.deepStrictEqual(setAgentToolRule(allowList, 'read', false), { '*': false });
  // Wildcard `slack_*` cleans up redundant matching entries.
  assert.deepStrictEqual(
    setAgentToolRule({ slack_search: false, slack_post: false, bash: false }, 'slack_*', false),
    { bash: false, 'slack_*': false }
  );
});

test('cleanPermissionConflict removes conflicting whole-tool permissions but keeps granular patterns', () => {
  const cleaned = cleanPermissionConflict(
    {
      permission: {
        edit: 'deny',
        bash: { '*': 'deny', 'git diff*': 'allow' }
      }
    },
    'edit'
  );
  assert.deepStrictEqual(cleaned, {
    permission: {
      bash: { '*': 'deny', 'git diff*': 'allow' }
    }
  });

  const cleanedBash = cleanPermissionConflict(cleaned, 'bash');
  assert.deepStrictEqual(cleanedBash, {
    permission: {
      bash: { 'git diff*': 'allow' }
    }
  });
});

test('resolveAgentToolInventory resolves per-agent tool states against global and board policy', () => {
  const base: SessionToolInventory = {
    cwd: '/repo',
    tools: [
      { name: 'read', source: 'builtin', enabled: true, used: 0 },
      { name: 'edit', source: 'builtin', enabled: true, used: 0 },
      { name: 'webfetch', source: 'builtin', enabled: true, used: 0 }
    ],
    servers: [],
    warnings: [],
    policy: { webfetch: false },
    globalTools: {},
    pendingRestart: false,
    generatedAt: 0
  };

  const resolved = resolveAgentToolInventory(base, {
    id: 'reviewer',
    sourceKind: 'markdown',
    tools: { edit: false }
  });
  const byName = new Map(resolved.tools.map((t) => [t.name, t]));
  assert.strictEqual(byName.get('read')?.enabled, true);
  assert.strictEqual(byName.get('edit')?.enabled, false);
  assert.strictEqual(byName.get('edit')?.disabledBy, 'agent');
  assert.strictEqual(byName.get('webfetch')?.enabled, false);
  assert.strictEqual(byName.get('webfetch')?.disabledBy, 'board');
});

test('filterCustomAgents and groupCustomAgents filter and bucket by scope', () => {
  const items = [
    parseAgentMarkdown('---\ndescription: Project reviewer\n---\n', {
      id: 'reviewer',
      scope: 'project',
      filePath: '/repo/.opencode/agents/reviewer.md',
      locationLabel: '.opencode/agents'
    }),
    parseAgentMarkdown('---\ndescription: Global helper\n---\n', {
      id: 'helper',
      scope: 'global',
      filePath: '/cfg/agents/helper.md',
      locationLabel: '~/.config/opencode/agents'
    })
  ];
  assert.strictEqual(filterCustomAgents(items, 'review').length, 1);
  const grouped = groupCustomAgents(items);
  assert.strictEqual(grouped.project.length, 1);
  assert.strictEqual(grouped.global.length, 1);
  assert.strictEqual(grouped.builtin.length, 0);
});
