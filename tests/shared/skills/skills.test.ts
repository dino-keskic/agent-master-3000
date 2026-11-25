import test from 'node:test';
import assert from 'node:assert';
import {
  filterSkills,
  groupSkills,
  isRecommendedSkillName,
  isValidSkillName,
  parseSkillMarkdown,
  serializeSkillMarkdown,
  slugifySkillName
} from '../../../shared/skills/skills.js';

test('skill name validation and slugification', () => {
  assert.ok(isValidSkillName('git-release'));
  assert.ok(isRecommendedSkillName('git-release'));
  assert.ok(!isRecommendedSkillName('Git_Release'));
  assert.ok(isValidSkillName('Git_Release'));
  assert.ok(!isValidSkillName('../bad'));
  assert.ok(!isValidSkillName('a/b'));
  assert.strictEqual(slugifySkillName('API Docs Helper!'), 'api-docs-helper');
});

test('parseSkillMarkdown and serializeSkillMarkdown round-trip metadata and body', () => {
  const raw = [
    '---',
    'name: conventional-commits',
    'description: Generate conventional commit messages',
    'compatibility: opencode',
    'license: MIT',
    'allowed-tools: [read, grep]',
    'metadata:',
    '  workflow: git',
    'extra: keep',
    '---',
    '',
    '# Guidelines',
    '',
    '- Use `feat:` or `fix:`.',
    ''
  ].join('\n');

  const parsed = parseSkillMarkdown(raw, {
    dirName: 'conventional-commits',
    scope: 'project',
    layout: 'opencode',
    dirPath: '/repo/.opencode/skills/conventional-commits',
    filePath: '/repo/.opencode/skills/conventional-commits/SKILL.md',
    locationLabel: '.opencode/skills'
  });

  assert.strictEqual(parsed.name, 'conventional-commits');
  assert.strictEqual(parsed.description, 'Generate conventional commit messages');
  assert.strictEqual(parsed.compatibility, 'opencode');
  assert.strictEqual(parsed.license, 'MIT');
  assert.deepStrictEqual(parsed.allowedTools, ['read', 'grep']);
  assert.deepStrictEqual(parsed.metadata, { workflow: 'git' });
  assert.strictEqual(parsed.extraFrontmatter?.extra, 'keep');

  const out = serializeSkillMarkdown(parsed);
  const again = parseSkillMarkdown(out, {
    dirName: 'conventional-commits',
    scope: 'project',
    layout: 'opencode',
    dirPath: '/repo/.opencode/skills/conventional-commits',
    filePath: '/repo/.opencode/skills/conventional-commits/SKILL.md',
    locationLabel: '.opencode/skills'
  });
  assert.strictEqual(again.name, 'conventional-commits');
  assert.deepStrictEqual(again.allowedTools, ['read', 'grep']);
  assert.deepStrictEqual(again.metadata, { workflow: 'git' });
  assert.strictEqual(again.extraFrontmatter?.extra, 'keep');
});

test('filterSkills and groupSkills filter and split project from global', () => {
  const skills = [
    parseSkillMarkdown('---\nname: local-skill\ndescription: Project helper\n---\n', {
      dirName: 'local-skill',
      scope: 'project',
      layout: 'opencode',
      dirPath: '/repo/.opencode/skills/local-skill',
      filePath: '/repo/.opencode/skills/local-skill/SKILL.md',
      locationLabel: '.opencode/skills'
    }),
    parseSkillMarkdown('---\nname: global-skill\ndescription: Global helper\n---\n', {
      dirName: 'global-skill',
      scope: 'global',
      layout: 'opencode',
      dirPath: '/cfg/skills/global-skill',
      filePath: '/cfg/skills/global-skill/SKILL.md',
      locationLabel: '~/.config/opencode/skills'
    })
  ];
  assert.strictEqual(filterSkills(skills, 'project').length, 1);
  const grouped = groupSkills(skills);
  assert.strictEqual(grouped.project.length, 1);
  assert.strictEqual(grouped.global.length, 1);
});
