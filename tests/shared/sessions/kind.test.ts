import test from 'node:test';
import assert from 'node:assert';
import { classifySessionLogs, classifyShellCommand, classifyTool, inspectShellCommand, writesViaRedirect } from '../../../shared/sessions/kind.js';
import { TaskLogItem, ToolCallInfo } from '../../../shared/types.js';

function tool(name: string, kind: string, command?: string): TaskLogItem {
  const info: ToolCallInfo = {
    toolCallId: name + Math.random(),
    name,
    kind: kind,
    status: 'completed',
    rawInput: command ? { command } : undefined
  };
  return { id: info.toolCallId, timestamp: 1, type: 'tool_call', text: '', toolCall: info };
}

test('session kind from tools, not from the execute pipe', async (t) => {
  await t.test('cd && rg is search; sed -n is read; sed -i is edit', () => {
    assert.deepStrictEqual(
      classifyShellCommand('cd packages/billing && rtk rg -n "InvoiceBuilder" .'),
      ['search']
    );
    assert.deepStrictEqual(classifyShellCommand("sed -n '60,120p' foo.dart"), ['read']);
    assert.deepStrictEqual(classifyShellCommand("sed -i '' 's/a/b/' foo.dart"), ['edit']);
    assert.deepStrictEqual(classifyShellCommand('fvm flutter test test/foo_test.dart'), ['test']);
    assert.deepStrictEqual(classifyShellCommand('gh pr view 36989 --json title'), ['review']);
    assert.deepStrictEqual(classifyShellCommand('rtk read lib/foo.dart'), ['read']);
  });

  await t.test('git status/diff is ignored; commit/push/pr create are shipping', () => {
    assert.deepStrictEqual(inspectShellCommand('git status --short && git diff'), { work: [], ship: [] });
    assert.deepStrictEqual(
      inspectShellCommand("git add -A && git commit -m $'line1\\nline2'"),
      { work: [], ship: ['committed'] }
    );
    assert.deepStrictEqual(inspectShellCommand('git push -u origin enable-jims'), { work: [], ship: ['pushed'] });
    assert.deepStrictEqual(
      inspectShellCommand('gh pr create --draft --title "x"'),
      { work: [], ship: ['pr'] }
    );
  });

  await t.test('ACP edit counts; unnamed shell does not become edits', () => {
    const kinds = classifyTool({ name: 'execute', kind: 'execute', rawInput: { command: 'python -c "open(\'f\',\'w\').write(\'x\')"' } });
    assert.deepStrictEqual(kinds.work, ['shell']);
    assert.deepStrictEqual(classifyTool({ name: 'edit', kind: 'edit' }).work, ['edit']);
  });

  await t.test('marionette session is device test even with lots of execute', () => {
    const logs = [
      ...Array.from({ length: 20 }, () => tool('marionette_tap', 'other')),
      ...Array.from({ length: 10 }, () => tool('execute', 'execute', 'sleep 1')),
      tool('read', 'read')
    ];
    const kind = classifySessionLogs(logs);
    assert.strictEqual(kind?.kind, 'device');
    assert.match(kind?.label || '', /device test/);
    assert.ok(!kind?.label.includes('reading'));
  });

  await t.test('lots of rg via terminal plus real edits is edits, not shell or git', () => {
    const logs = [
      ...Array.from({ length: 40 }, () => tool('execute', 'execute', 'cd ms && rtk rg -n Foo .')),
      ...Array.from({ length: 12 }, () => tool('edit', 'edit')),
      ...Array.from({ length: 8 }, () => tool('read', 'read')),
      tool('execute', 'execute', 'git status --short')
    ];
    const kind = classifySessionLogs(logs);
    assert.strictEqual(kind?.kind, 'edit');
    assert.strictEqual(kind?.label, 'edits');
    assert.ok(kind?.buckets.search >= 40);
    assert.ok(!kind?.shipped);
  });

  await t.test('jira ticket reads are not a review session', () => {
    const logs = Array.from({ length: 8 }, () => tool('jira_read', 'other'));
    const kind = classifySessionLogs(logs);
    assert.ok(!kind?.kind || kind.kind !== 'review');
    assert.ok(!kind?.label.includes('review'));
  });

  await t.test('gh pr view is review; gh pr create is PR opened', () => {
    const review = classifySessionLogs([
      ...Array.from({ length: 8 }, () => tool('execute', 'execute', 'gh pr view 1 --json title')),
      tool('jira_read', 'other')
    ]);
    assert.strictEqual(review?.kind, 'review');
    assert.ok(!review?.shipped);

    const shipped = classifySessionLogs([
      tool('edit', 'edit'),
      tool('execute', 'execute', 'git status --short && git commit -m "feat"'),
      tool('execute', 'execute', 'git push -u origin enable-jims'),
      tool('execute', 'execute', 'gh pr create --draft --title "x"')
    ]);
    assert.strictEqual(shipped?.kind, 'edit');
    assert.strictEqual(shipped?.shipped, 'pr');
    assert.strictEqual(shipped?.shipLabel, 'PR opened');
  });

  await t.test('push without a PR is pushed, not a git kind', () => {
    const logs = [
      tool('edit', 'edit'),
      tool('execute', 'execute', 'git commit -m "wip"'),
      tool('execute', 'execute', 'git push origin HEAD')
    ];
    const kind = classifySessionLogs(logs);
    assert.strictEqual(kind?.kind, 'edit');
    assert.strictEqual(kind?.shipLabel, 'pushed');
  });

  await t.test('shell redirects count as edits even for ignored verbs', () => {
    // Regression: `printf ... > file` writes a file, but `printf` is on the
    // noise list, so these sessions used to classify as having done nothing.
    assert.strictEqual(writesViaRedirect("printf '%s\\n' 'hi' > TESTFILE.md"), true);
    assert.strictEqual(writesViaRedirect('echo hi >> notes.md'), true);
    assert.strictEqual(writesViaRedirect('npm run build > build.log'), true);
    assert.strictEqual(writesViaRedirect('grep foo bar.txt | tee out.txt'), true);
    assert.strictEqual(writesViaRedirect('node x.js &> out.log'), true);

    // Stream duplication and quoted angle brackets are not writes.
    assert.strictEqual(writesViaRedirect('npm test 2>&1'), false);
    assert.strictEqual(writesViaRedirect('cmd >&2'), false);
    assert.strictEqual(writesViaRedirect("echo 'a > b'"), false);
    assert.strictEqual(writesViaRedirect('cat a.txt'), false);

    assert.strictEqual(
      classifySessionLogs([tool('bash', 'execute', "printf 'hi' > TESTFILE.md")])?.kind,
      'edit'
    );
    assert.strictEqual(
      classifySessionLogs([tool('bash', 'execute', 'echo hi > notes.md')])?.label,
      'edits'
    );
  });
});
