import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

function setupSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-skills-'));
  const project = path.join(root, 'repo');
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(project, '.git'), { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = path.join(home, '.config');
  fs.mkdirSync(path.join(process.env.XDG_CONFIG_HOME, 'opencode'), { recursive: true });
  delete process.env.OPENCODE_CONFIG_DIR;
  return { root, project, home };
}

test('listSkills, saveSkill, auxiliary files, and deleteSkill work end-to-end', async () => {
  const dirs = setupSandbox();
  const mod = await import(`../../../server/opencode/skills.js?t=${Math.random()}`);

  const created = mod.saveSkill(dirs.project, {
    name: 'git-release',
    scope: 'project',
    description: 'Create clean releases',
    compatibility: 'opencode',
    body: '# Release Steps\n\n1. Check status.'
  });

  assert.strictEqual(created.name, 'git-release');
  assert.strictEqual(created.scope, 'project');
  assert.ok(fs.existsSync(path.join(dirs.project, '.opencode', 'skills', 'git-release', 'SKILL.md')));

  const files = mod.saveSkillAuxFile(dirs.project, created.dirPath, 'references/checklist.md', '- Tag release\n');
  assert.ok(files.some((f: { relativePath: string }) => f.relativePath === 'references/checklist.md'));

  const readAux = mod.readSkillAuxFile(dirs.project, created.dirPath, 'references/checklist.md');
  assert.strictEqual(readAux.content, '- Tag release\n');

  const listed = mod.listSkills(dirs.project);
  assert.strictEqual(listed.length, 1);
  assert.strictEqual(listed[0].files.length, 2);

  mod.deleteSkill(dirs.project, created.dirPath);
  assert.ok(!fs.existsSync(created.dirPath));
});

test('saveSkill rejects path traversal', async () => {
  const dirs = setupSandbox();
  const mod = await import(`../../../server/opencode/skills.js?t=${Math.random()}`);
  assert.throws(() =>
    mod.saveSkill(dirs.project, {
      name: '../escape',
      scope: 'project',
      description: 'bad',
      body: 'bad'
    })
  );
  assert.throws(() => mod.deleteSkill(dirs.project, '/etc'));
});
