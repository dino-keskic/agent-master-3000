import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

function setupSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-custom-agents-'));
  const project = path.join(root, 'repo');
  const home = path.join(root, 'home');
  const global = path.join(root, 'global-config');
  fs.mkdirSync(path.join(project, '.git'), { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(global, { recursive: true });
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = path.join(home, '.config');
  fs.mkdirSync(path.join(process.env.XDG_CONFIG_HOME, 'opencode'), { recursive: true });
  process.env.OPENCODE_CONFIG_DIR = global;
  return { root, project, global: path.join(process.env.XDG_CONFIG_HOME, 'opencode'), extra: global };
}

test('listCustomAgents, saveCustomAgent, toggleCustomAgentTool, and deleteCustomAgent work end-to-end on disk', async () => {
  const dirs = setupSandbox();
  const mod = await import(`../../../server/opencode/customAgents.js?t=${Math.random()}`);

  const created = mod.saveCustomAgent(dirs.project, {
    id: 'reviewer',
    scope: 'project',
    description: 'Strict code reviewer',
    mode: 'subagent',
    prompt: 'Review diffs only.',
    tools: { edit: false, write: false }
  });

  assert.strictEqual(created.id, 'reviewer');
  assert.strictEqual(created.scope, 'project');
  assert.ok(fs.existsSync(path.join(dirs.project, '.opencode', 'agents', 'reviewer.md')));

  const listed = mod.listCustomAgents(dirs.project, {
    runtimeAgents: [
      { name: 'build', description: 'Default' },
      { name: 'reviewer', description: 'Strict code reviewer' }
    ]
  });
  assert.strictEqual(listed.length, 2);
  assert.strictEqual(listed.find((a: { id: string }) => a.id === 'build')?.scope, 'builtin');

  const toggled = mod.toggleCustomAgentTool(dirs.project, created.filePath, 'webfetch', false);
  assert.deepStrictEqual(toggled.tools, { edit: false, write: false, webfetch: false });

  const enabledEdit = mod.toggleCustomAgentTool(dirs.project, created.filePath, 'edit', true);
  assert.deepStrictEqual(enabledEdit.tools, { write: false, webfetch: false });

  mod.deleteCustomAgent(dirs.project, created.filePath);
  assert.ok(!fs.existsSync(created.filePath));
});

test('saveCustomAgent rejects path traversal outside OpenCode agent directories', async () => {
  const dirs = setupSandbox();
  const mod = await import(`../../../server/opencode/customAgents.js?t=${Math.random()}`);
  assert.throws(() =>
    mod.saveCustomAgent(dirs.project, {
      id: '../outside',
      scope: 'project',
      description: '',
      prompt: '',
      tools: {}
    })
  );
  assert.throws(() => mod.deleteCustomAgent(dirs.project, '/etc/passwd'));
});
