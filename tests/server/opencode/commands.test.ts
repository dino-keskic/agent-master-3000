import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { SlashCommand } from '../../../shared/composer/slashCommands.js';

/**
 * Every root is redirected into a temp tree: this must never read the real
 * OpenCode install, and a test that did would also pick up whatever the machine
 * running it happens to have configured.
 */
function sandbox(): { project: string; global: string; home: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-commands-'));
  return {
    project: fs.mkdirSync(path.join(root, 'repo'), { recursive: true }) || path.join(root, 'repo'),
    global: fs.mkdirSync(path.join(root, 'config'), { recursive: true }) || path.join(root, 'config'),
    home: fs.mkdirSync(path.join(root, 'home'), { recursive: true }) || path.join(root, 'home')
  };
}

function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

async function load(dirs: { global: string; home: string }) {
  process.env.OPENCODE_CONFIG_DIR = dirs.global;
  process.env.HOME = dirs.home;
  const mod = await import(`../../../server/opencode/commands.js?t=${Math.random()}`);
  return mod.listAgentCommands as (cwd?: string) => { commands: SlashCommand[]; error?: string };
}

test('commands and skills are read from the project and the global config', async () => {
  const dirs = sandbox();
  write(path.join(dirs.project, '.opencode/command/review.md'), '---\ndescription: Review the diff\n---\nDo it.\n');
  write(path.join(dirs.project, '.opencode/skill/deep-research/SKILL.md'), '---\nname: deep-research\ndescription: Dig through sources\n---\n');
  write(path.join(dirs.global, 'command/standup.md'), '---\ndescription: Write a standup note\n---\n');

  const listAgentCommands = await load(dirs);
  const { commands } = listAgentCommands(dirs.project);
  const byLabel = new Map(commands.map((c) => [c.label, c]));

  assert.strictEqual(byLabel.get('review')?.description, 'Review the diff');
  assert.strictEqual(byLabel.get('review')?.source, 'project');
  assert.strictEqual(byLabel.get('review')?.insert, '/review ');
  assert.strictEqual(byLabel.get('standup')?.source, 'global');
  assert.strictEqual(byLabel.get('deep-research')?.kind, 'skill');
  assert.strictEqual(byLabel.get('deep-research')?.description, 'Dig through sources');
});

test('a project command shadows a global one of the same name', async () => {
  const dirs = sandbox();
  write(path.join(dirs.project, '.opencode/command/review.md'), '---\ndescription: Project version\n---\n');
  write(path.join(dirs.global, 'command/review.md'), '---\ndescription: Global version\n---\n');

  const listAgentCommands = await load(dirs);
  const rows = listAgentCommands(dirs.project).commands.filter((c) => c.label === 'review');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0]!.description, 'Project version');
});

test('the Claude layout and nested folders are both picked up', async () => {
  const dirs = sandbox();
  write(path.join(dirs.project, '.claude/commands/git/tidy.md'), 'Tidy the branch up.\n');
  write(path.join(dirs.project, '.claude/skills/artifact-design/SKILL.md'), '---\ndescription: Design pages\n---\n');

  const listAgentCommands = await load(dirs);
  const labels = listAgentCommands(dirs.project).commands.map((c) => c.label);
  assert.ok(labels.includes('git/tidy'), `nested command missing from ${labels.join(', ')}`);
  assert.ok(labels.includes('artifact-design'));
});

test('a command with no frontmatter falls back to its first line of prose', async () => {
  const dirs = sandbox();
  write(path.join(dirs.project, '.opencode/command/tidy.md'), '# Tidy\n\nClean the working tree.\n');
  const listAgentCommands = await load(dirs);
  const tidy = listAgentCommands(dirs.project).commands.find((c) => c.label === 'tidy');
  assert.strictEqual(tidy?.description, 'Clean the working tree.');
});

test('the built-ins are always there, even with nothing on disk', async () => {
  const dirs = sandbox();
  const listAgentCommands = await load(dirs);
  const labels = listAgentCommands(dirs.project).commands.map((c) => c.label);
  assert.deepStrictEqual(labels, ['compact', 'init']);
});
