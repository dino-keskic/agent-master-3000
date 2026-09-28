import test from 'node:test';
import assert from 'node:assert';
import {
  findSubagent,
  markRunningSubagents,
  runningSubagentCount,
  subagentCaller,
  subagentLabel,
  subagentPath,
  subagentUsage
} from '../../../shared/sessions/subagents.js';
import { isSubagentTool } from '../../../shared/agent/toolCall.js';
import { SubagentSession } from '../../../shared/sessions/types.js';

function node(sessionId: string, parentId: string, extra: Partial<SubagentSession> = {}): SubagentSession {
  return { sessionId, parentId, title: sessionId, children: [], ...extra };
}

const reviewer = node('ses-review', 'ses-root', {
  title: 'Review the PR (@coderabbit-code-reviewer subagent)',
  children: [node('ses-nested', 'ses-review', { title: 'Check the migration', agent: 'explore' })]
});
const tree: SubagentSession[] = [reviewer, node('ses-docs', 'ses-root', { title: 'Write docs', agent: 'general' })];

test('subagent tree reading', async (t) => {
  await t.test('finds a node at any depth', () => {
    assert.strictEqual(findSubagent(tree, 'ses-nested')?.title, 'Check the migration');
    assert.strictEqual(findSubagent(tree, 'ses-missing'), undefined);
  });

  await t.test('the path is root-to-node', () => {
    assert.deepStrictEqual(
      subagentPath(tree, 'ses-nested').map((n) => n.sessionId),
      ['ses-review', 'ses-nested']
    );
    assert.deepStrictEqual(subagentPath(tree, 'ses-missing'), []);
  });

  await t.test('labels prefer the invoked @name, then the agent, then the title', () => {
    assert.strictEqual(subagentLabel(reviewer), '@coderabbit-code-reviewer');
    assert.strictEqual(subagentLabel(findSubagent(tree, 'ses-nested')), '@explore');
    assert.strictEqual(subagentLabel(node('ses-x', 'ses-root', { title: 'Find the leak' })), 'Find the leak');
    assert.strictEqual(subagentLabel(undefined), 'Subagent');
  });

  await t.test('an agent name with spaces is not made into a handle', () => {
    assert.strictEqual(subagentLabel(node('ses-y', 'ses-root', { title: '', agent: 'Ask Agent' })), 'Ask Agent');
  });

  await t.test('a top-level subagent was called by the session it hangs off', () => {
    assert.deepStrictEqual(subagentCaller(tree, 'ses-docs', '@build'), {
      sessionId: 'ses-root',
      label: '@build',
      isRoot: true
    });
  });

  await t.test('a nested subagent was called by the subagent above it, not by the user', () => {
    assert.deepStrictEqual(subagentCaller(tree, 'ses-nested', '@build'), {
      sessionId: 'ses-review',
      label: '@coderabbit-code-reviewer',
      isRoot: false
    });
  });

  await t.test('a session outside the tree has no caller to name', () => {
    assert.strictEqual(subagentCaller(tree, 'ses-root', '@build'), undefined);
  });

  await t.test('only subagent-spawning tools open a child session', () => {
    assert.ok(isSubagentTool('task'));
    assert.ok(isSubagentTool('Task'));
    assert.ok(!isSubagentTool('read'));
    assert.ok(!isSubagentTool(undefined));
  });
});

test('running subagents', async (t) => {
  const tree = [
    node('ses-review', 'ses-root', {
      children: [node('ses-nested', 'ses-review')]
    }),
    node('ses-docs', 'ses-root')
  ];

  await t.test('every live session is flagged, however deep it sits', () => {
    const marked = markRunningSubagents(tree, new Set(['ses-nested']));
    assert.strictEqual(marked[0]?.running, false);
    assert.strictEqual(marked[0]?.children[0]?.running, true);
    assert.strictEqual(marked[1]?.running, false);
  });

  await t.test('the original tree is left alone, so React sees a new one', () => {
    const marked = markRunningSubagents(tree, new Set(['ses-docs']));
    assert.strictEqual(tree[1]?.running, undefined);
    assert.notStrictEqual(marked[1], tree[1]);
  });

  await t.test('sessions that are not in the tree do not invent nodes', () => {
    const marked = markRunningSubagents(tree, new Set(['ses-elsewhere']));
    assert.strictEqual(runningSubagentCount(marked), 0);
  });

  await t.test('the count reaches every depth', () => {
    const marked = markRunningSubagents(tree, new Set(['ses-review', 'ses-nested']));
    assert.strictEqual(runningSubagentCount(marked), 2);
  });
});

test('subagent usage line', async (t) => {
  await t.test('prints the short model, own spend, tokens and context fill', () => {
    const usage = subagentUsage(node('ses-a', 'ses-root', {
      model: 'anthropic/claude-haiku-4-5',
      cost: 0.4213,
      tokenCount: 182_400,
      contextTokens: 41_000,
      contextLimit: 200_000
    }));
    assert.deepStrictEqual(usage, {
      model: 'claude-haiku-4-5',
      cost: '$0.42',
      tokens: '182k tok',
      context: '41k / 200k',
      contextPct: 21,
      treeCost: undefined
    });
  });

  await t.test('an unknown window still shows how full the last turn was', () => {
    const usage = subagentUsage(node('ses-b', 'ses-root', { contextTokens: 9_000 }));
    assert.strictEqual(usage.context, '9k ctx');
    assert.strictEqual(usage.contextPct, undefined);
  });

  await t.test('a session that has not spent anything prints nothing', () => {
    assert.deepStrictEqual(subagentUsage(node('ses-c', 'ses-root')), {
      model: undefined,
      cost: undefined,
      tokens: undefined,
      context: undefined,
      contextPct: undefined,
      treeCost: undefined
    });
  });

  await t.test('the rolled-up cost is offered only when children added to it', () => {
    assert.strictEqual(subagentUsage(node('ses-d', 'ses-root', { cost: 1, treeCost: 1.5 })).treeCost, '$1.50');
    assert.strictEqual(subagentUsage(node('ses-e', 'ses-root', { cost: 1, treeCost: 1.001 })).treeCost, undefined);
  });
});
