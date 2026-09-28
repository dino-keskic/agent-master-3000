import test from 'node:test';
import assert from 'node:assert';
import {
  autoDecision,
  isAccessWithinFolder,
  isReadOnlyTool,
  pickAutoApproveOption,
  pickRejectOption,
  sortPermissionOptions
} from '../../../shared/agent/permissions.js';
import { PermissionOption, ToolCallInfo } from '../../../shared/types.js';

const tool = (kind: string, name = kind): Pick<ToolCallInfo, 'kind' | 'name'> => ({ kind, name });

const OPTIONS: PermissionOption[] = [
  { optionId: 'rej-always', name: 'Reject always', kind: 'reject_always' },
  { optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' },
  { optionId: 'rej', name: 'Reject', kind: 'reject_once' },
  { optionId: 'allow', name: 'Allow once', kind: 'allow_once' }
];

test('permission policy', async (t) => {
  await t.test('read-only classification covers ACP kinds and bare tool names', () => {
    assert.ok(isReadOnlyTool('read'));
    assert.ok(isReadOnlyTool('search'));
    assert.ok(isReadOnlyTool('fetch'));
    assert.ok(isReadOnlyTool(undefined, 'grep'));
    assert.ok(!isReadOnlyTool('edit'));
    assert.ok(!isReadOnlyTool('execute'));
    // A delete dressed up as a read is still a write.
    assert.ok(!isReadOnlyTool('delete'));
    assert.ok(!isReadOnlyTool('read_delete'));
    // Unknown kinds (external_directory, etc.) must ask — not auto-approve.
    assert.ok(!isReadOnlyTool('other'));
  });

  await t.test('auto mode approves everything, including shell', () => {
    assert.strictEqual(autoDecision('auto', tool('execute')), 'approve');
    assert.strictEqual(autoDecision('auto', tool('edit')), 'approve');
  });

  await t.test('review-writes approves reads but stops edits and shell', () => {
    assert.strictEqual(autoDecision('review-writes', tool('read')), 'approve');
    assert.strictEqual(autoDecision('review-writes', tool('search')), 'approve');
    assert.strictEqual(autoDecision('review-writes', tool('edit')), undefined);
    assert.strictEqual(autoDecision('review-writes', tool('execute')), undefined);
    assert.strictEqual(autoDecision('review-writes', tool('other', 'external_directory')), undefined);
  });

  await t.test('manual mode never decides on its own', () => {
    assert.strictEqual(autoDecision('manual', tool('read')), undefined);
    assert.strictEqual(autoDecision('manual', tool('edit')), undefined);
  });

  await t.test('options sort approvals first so the buttons never reshuffle', () => {
    assert.deepStrictEqual(
      sortPermissionOptions(OPTIONS).map((o) => o.kind),
      ['allow_once', 'allow_always', 'reject_once', 'reject_always']
    );
  });

  await t.test('auto-approve prefers a one-shot allow over a standing one', () => {
    assert.strictEqual(pickAutoApproveOption(OPTIONS), 'allow');
    assert.strictEqual(
      pickAutoApproveOption(OPTIONS.filter((o) => o.kind !== 'allow_once')),
      'allow-always'
    );
    assert.strictEqual(pickAutoApproveOption([]), undefined);
  });

  await t.test('reject falls back to a standing reject, then to nothing', () => {
    assert.strictEqual(pickRejectOption(OPTIONS), 'rej');
    assert.strictEqual(pickRejectOption([{ optionId: 'x', name: 'no', kind: 'reject_always' }]), 'x');
    assert.strictEqual(pickRejectOption([{ optionId: 'y', name: 'ok', kind: 'allow_once' }]), undefined);
  });
});

test('external-directory access inside the session folder', async (t) => {
  const access = (parentDir: unknown, filepath?: unknown) => ({ rawInput: { parentDir, filepath } });
  const folder = '/src/app-worktrees/feature';

  await t.test('files in the folder and below it pass', () => {
    assert.ok(isAccessWithinFolder(access(folder, `${folder}/a.ts`), folder));
    assert.ok(isAccessWithinFolder(access(`${folder}/deep/dir`, `${folder}/deep/dir/b.ts`), `${folder}/`));
    assert.ok(isAccessWithinFolder({ rawInput: { parentDir: folder } }, folder));
  });

  await t.test('anything outside, or pretending to be inside, still asks', () => {
    assert.ok(!isAccessWithinFolder(access('/src/app', '/src/app/a.ts'), folder));
    assert.ok(!isAccessWithinFolder(access(`${folder}-other`, `${folder}-other/a.ts`), folder));
    assert.ok(!isAccessWithinFolder(access(`${folder}/../..`, '/etc/passwd'), folder));
    assert.ok(!isAccessWithinFolder(access(folder, '/etc/passwd'), folder));
    assert.ok(!isAccessWithinFolder(access('relative/dir'), folder));
    assert.ok(!isAccessWithinFolder({ rawInput: { command: 'ls' } }, folder));
    assert.ok(!isAccessWithinFolder(access(folder), undefined));
  });
});
