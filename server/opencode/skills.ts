import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  SaveSkillInput,
  SkillFileInfo,
  SkillItem,
  SkillLayout,
  SkillScope,
  isValidSkillName,
  parseSkillMarkdown,
  serializeSkillMarkdown
} from '../../shared/skills/skills.js';
import { projectConfigFolders } from '../../shared/setup/configLayers.js';
import { gitRoot } from '../setup/configLayers.js';
import { opencodeGlobalConfigDirs } from '../setup/locations.js';
import { clearCommandsCache } from './commands.js';

/**
 * Reading, creating, editing, and deleting OpenCode skills (`SKILL.md`
 * directories) on disk, including auxiliary files (`references/`, `scripts/`,
 * `assets/`).
 *
 * All writes are strictly confined to OpenCode/Claude/Agents skill roots under
 * `cwd` or the resolved global config directories.
 */

const SKILL_SUBDIRS = ['skills', 'skill'] as const;
const MAX_AUX_FILE_BYTES = 256 * 1024;
const MAX_SCAN_DEPTH = 3;

function isInsideDir(target: string, dir: string): boolean {
  const resolvedTarget = path.resolve(target);
  const resolvedDir = path.resolve(dir);
  const rel = path.relative(resolvedDir, resolvedTarget);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function writeAtomic(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
}

function displayLabel(dir: string, cwd: string): string {
  const home = os.homedir();
  const rel = path.relative(cwd, dir);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel;
  if (dir === home || dir.startsWith(home + path.sep)) return `~/${path.relative(home, dir)}`;
  return dir;
}

interface SkillRoot {
  dir: string;
  scope: SkillScope;
  layout: SkillLayout;
}

function skillRoots(cwd: string): SkillRoot[] {
  const resolvedCwd = path.resolve(cwd);
  const home = os.homedir();
  const roots: SkillRoot[] = [];
  const seen = new Set<string>();

  const pushRoot = (dir: string, scope: SkillScope, layout: SkillLayout) => {
    const resolved = path.resolve(dir);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    roots.push({ dir: resolved, scope, layout });
  };

  for (const folder of projectConfigFolders(resolvedCwd, gitRoot(resolvedCwd))) {
    for (const [layout, base] of [
      ['opencode', '.opencode'],
      ['claude', '.claude'],
      ['agents', '.agents']
    ] as const) {
      for (const sub of SKILL_SUBDIRS) {
        pushRoot(path.join(folder, base, sub), 'project', layout);
      }
    }
  }

  for (const dir of [...opencodeGlobalConfigDirs()].reverse()) {
    for (const sub of SKILL_SUBDIRS) pushRoot(path.join(dir, sub), 'global', 'opencode');
  }
  for (const sub of SKILL_SUBDIRS) pushRoot(path.join(home, '.claude', sub), 'global', 'claude');
  for (const sub of SKILL_SUBDIRS) pushRoot(path.join(home, '.agents', sub), 'global', 'agents');

  return roots;
}

export function defaultSkillWriteDir(cwd: string, scope: SkillScope): string {
  if (scope === 'project') return path.join(path.resolve(cwd), '.opencode', 'skills');
  const globalDir = opencodeGlobalConfigDirs()[0] || path.join(os.homedir(), '.config', 'opencode');
  return path.join(path.resolve(globalDir), 'skills');
}

function assertAllowedSkillDir(cwd: string, dirPath: string): string {
  const resolved = path.resolve(dirPath);
  if (!skillRoots(cwd).some((root) => isInsideDir(resolved, root.dir) && path.dirname(resolved) === root.dir)) {
    throw new Error('Skill directory is outside OpenCode skill directories');
  }
  return resolved;
}

function isLikelyText(filePath: string, size: number): boolean {
  if (size > MAX_AUX_FILE_BYTES) return false;
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(Math.min(512, size));
      const read = fs.readSync(fd, buf, 0, buf.length, 0);
      for (let i = 0; i < read; i++) {
        if (buf[i] === 0) return false;
      }
      return true;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

function listSkillFiles(skillDir: string, prefix = '', depth = 0): SkillFileInfo[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(skillDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: SkillFileInfo[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(skillDir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (depth < MAX_SCAN_DEPTH) files.push(...listSkillFiles(full, rel, depth + 1));
    } else if (entry.isFile()) {
      let size = 0;
      try {
        size = fs.statSync(full).size;
      } catch {
        // ignore
      }
      files.push({ relativePath: rel, size, isText: isLikelyText(full, size) });
    }
  }
  return files.sort((a, b) => {
    if (a.relativePath === 'SKILL.md') return -1;
    if (b.relativePath === 'SKILL.md') return 1;
    return a.relativePath.localeCompare(b.relativePath);
  });
}

export function listSkills(cwd: string): SkillItem[] {
  const resolvedCwd = path.resolve(cwd);
  const found: SkillItem[] = [];
  const primaryOwner = new Map<string, string>();

  for (const root of skillRoots(resolvedCwd)) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const sorted = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of sorted) {
      const dirPath = path.join(root.dir, entry.name);
      const filePath = path.join(dirPath, 'SKILL.md');
      if (!fs.existsSync(filePath)) continue;
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const label = displayLabel(root.dir, resolvedCwd);
        const item = parseSkillMarkdown(raw, {
          dirName: entry.name,
          scope: root.scope,
          layout: root.layout,
          dirPath,
          filePath,
          locationLabel: label,
          files: listSkillFiles(dirPath)
        });
        const key = item.name.toLowerCase();
        const owner = primaryOwner.get(key);
        if (owner) item.shadowedBy = owner;
        else primaryOwner.set(key, `${item.scope} (${label})`);
        found.push(item);
      } catch {
        // Ignore unreadable skill files.
      }
    }
  }

  return found;
}

export function saveSkill(cwd: string, input: SaveSkillInput): SkillItem {
  const name = input.name.trim();
  if (!isValidSkillName(name)) {
    throw new Error('Skill name must start with a letter or digit and use only letters, digits, ., _, or -');
  }
  const scope: SkillScope = input.scope === 'global' ? 'global' : 'project';

  const oldDir = input.dirPath ? assertAllowedSkillDir(cwd, input.dirPath) : undefined;
  let targetDir: string;
  let layout: SkillLayout = 'opencode';

  if (oldDir) {
    const oldRoot = skillRoots(cwd).find((r) => path.dirname(oldDir) === r.dir);
    const sameName = path.basename(oldDir) === name;
    if (sameName && oldRoot?.scope === scope) {
      targetDir = oldDir;
      layout = oldRoot.layout;
    } else {
      targetDir = path.join(defaultSkillWriteDir(cwd, scope), name);
    }
  } else {
    targetDir = path.join(defaultSkillWriteDir(cwd, scope), name);
  }

  assertAllowedSkillDir(cwd, targetDir);
  if (targetDir !== oldDir && fs.existsSync(targetDir)) {
    throw new Error(`A skill named "${name}" already exists at ${targetDir}`);
  }

  const content =
    typeof input.rawMarkdown === 'string'
      ? input.rawMarkdown
      : serializeSkillMarkdown({
          name,
          description: input.description,
          compatibility: input.compatibility,
          license: input.license,
          allowedTools: input.allowedTools,
          metadata: input.metadata,
          body: input.body,
          extraFrontmatter: input.extraFrontmatter
        });

  if (oldDir && oldDir !== targetDir && fs.existsSync(oldDir)) {
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.renameSync(oldDir, targetDir);
  }
  const filePath = path.join(targetDir, 'SKILL.md');
  writeAtomic(filePath, content);
  clearCommandsCache();

  return parseSkillMarkdown(content, {
    dirName: name,
    scope,
    layout,
    dirPath: targetDir,
    filePath,
    locationLabel: displayLabel(path.dirname(targetDir), path.resolve(cwd)),
    files: listSkillFiles(targetDir)
  });
}

export function deleteSkill(cwd: string, dirPath: string): void {
  const resolved = assertAllowedSkillDir(cwd, dirPath);
  if (!fs.existsSync(resolved)) throw new Error('Skill directory not found');
  fs.rmSync(resolved, { recursive: true, force: true });
  clearCommandsCache();
}

function assertSafeAuxFile(cwd: string, skillDir: string, relativePath: string): string {
  const dir = assertAllowedSkillDir(cwd, skillDir);
  const cleaned = relativePath.trim().replace(/\\/g, '/');
  if (!cleaned || cleaned.startsWith('/') || cleaned.includes('..') || cleaned.includes('\0')) {
    throw new Error('Invalid file path inside skill directory');
  }
  const full = path.resolve(dir, cleaned);
  if (!isInsideDir(full, dir)) {
    throw new Error('File path escapes skill directory');
  }
  return full;
}

export function readSkillAuxFile(cwd: string, skillDir: string, relativePath: string): { path: string; content: string } {
  const full = assertSafeAuxFile(cwd, skillDir, relativePath);
  const stat = fs.statSync(full);
  if (!stat.isFile()) throw new Error('Not a file');
  if (!isLikelyText(full, stat.size)) throw new Error('File is binary or too large to edit here');
  return { path: relativePath, content: fs.readFileSync(full, 'utf8') };
}

export function saveSkillAuxFile(cwd: string, skillDir: string, relativePath: string, content: string): SkillFileInfo[] {
  const full = assertSafeAuxFile(cwd, skillDir, relativePath);
  writeAtomic(full, content);
  clearCommandsCache();
  return listSkillFiles(assertAllowedSkillDir(cwd, skillDir));
}

export function deleteSkillAuxFile(cwd: string, skillDir: string, relativePath: string): SkillFileInfo[] {
  if (relativePath === 'SKILL.md') throw new Error('Cannot delete SKILL.md directly; delete the skill instead');
  const full = assertSafeAuxFile(cwd, skillDir, relativePath);
  if (fs.existsSync(full)) fs.unlinkSync(full);
  return listSkillFiles(assertAllowedSkillDir(cwd, skillDir));
}
