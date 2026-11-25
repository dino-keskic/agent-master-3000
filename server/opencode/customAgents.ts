import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  CustomAgent,
  SaveAgentInput,
  cleanPermissionConflict,
  extractAgentToolsFromFrontmatter,
  isValidAgentId,
  parseAgentMarkdown,
  serializeAgentMarkdown,
  setAgentToolRule
} from '../../shared/agent/customAgents.js';
import { parseFrontmatter } from '../../shared/agent/frontmatter.js';
import { parseJsonc } from '../../shared/jsonc.js';
import { OpenCodeAgent } from '../../shared/sessions/types.js';
import { AGENT_SUBDIRS, CONFIG_FILES, GLOBAL_FILES, projectConfigDirs, projectConfigFiles } from '../../shared/setup/configLayers.js';
import { gitRoot } from '../setup/configLayers.js';
import { opencodeConfigFilePaths, opencodeGlobalConfigDirs } from '../setup/locations.js';

/**
 * Reading, creating, editing, and deleting OpenCode custom agents on disk,
 * merged with OpenCode's runtime/built-in agent list.
 *
 * All writes are strictly confined to OpenCode's own agent directories under
 * `cwd` (`.opencode/agents/`) or the resolved global config directories.
 */

const MAX_DEPTH = 3;
/** Preferred subdir order when scanning; `agents` is OpenCode's canonical plural. */
const SCAN_SUBDIRS = ['agents', 'agent', 'modes', 'mode'] as const;

function isInsideDir(target: string, dir: string): boolean {
  const rel = path.relative(path.resolve(dir), path.resolve(target));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function writeAtomic(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
}

function collectMarkdownFiles(root: string, depth = 0, prefix = ''): { id: string; filePath: string }[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: { id: string; filePath: string }[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (depth < MAX_DEPTH) found.push(...collectMarkdownFiles(full, depth + 1, `${prefix}${entry.name}/`));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      found.push({ id: `${prefix}${entry.name.slice(0, -3)}`, filePath: full });
    }
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}

function displayLabel(dir: string, cwd: string): string {
  const home = os.homedir();
  const rel = path.relative(cwd, dir);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel;
  if (dir === home || dir.startsWith(home + path.sep)) return `~/${path.relative(home, dir)}`;
  return dir;
}

export function defaultAgentWriteDir(cwd: string, scope: 'project' | 'global'): string {
  if (scope === 'project') return path.join(path.resolve(cwd), '.opencode', 'agents');
  const globalDir = opencodeGlobalConfigDirs()[0] || path.join(os.homedir(), '.config', 'opencode');
  return path.join(path.resolve(globalDir), 'agents');
}

export function allowedAgentRoots(cwd: string): string[] {
  const roots: string[] = [];
  const resolvedCwd = path.resolve(cwd);
  for (const dir of projectConfigDirs(resolvedCwd, gitRoot(resolvedCwd))) {
    for (const sub of AGENT_SUBDIRS) roots.push(path.join(dir, sub));
  }
  for (const dir of opencodeGlobalConfigDirs()) {
    for (const sub of AGENT_SUBDIRS) roots.push(path.join(dir, sub));
  }
  return roots.map((r) => path.resolve(r));
}

function assertAllowedAgentFile(cwd: string, filePath: string): string {
  const resolved = path.resolve(filePath);
  if (!resolved.endsWith('.md')) {
    throw new Error('Only markdown (.md) agent files can be modified here');
  }
  if (!allowedAgentRoots(cwd).some((root) => isInsideDir(resolved, root))) {
    throw new Error('Agent path is outside OpenCode agent directories');
  }
  return resolved;
}

function readConfigAgents(
  filePath: string,
  scope: 'project' | 'global',
  locationLabel: string
): CustomAgent[] {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }
  const parsed = parseJsonc(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const record = parsed as Record<string, unknown>;
  const agentsObj =
    (record.agent && typeof record.agent === 'object' && !Array.isArray(record.agent)
      ? (record.agent as Record<string, unknown>)
      : undefined) ||
    (record.agents && typeof record.agents === 'object' && !Array.isArray(record.agents)
      ? (record.agents as Record<string, unknown>)
      : undefined);
  if (!agentsObj) return [];

  const out: CustomAgent[] = [];
  for (const [id, entry] of Object.entries(agentsObj)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const cfg = entry as Record<string, unknown>;
    const { tools, hasGranularPermissions } = extractAgentToolsFromFrontmatter(cfg);
    out.push({
      key: `${scope}:${filePath}:${id}`,
      id,
      name: id,
      scope,
      sourceKind: 'config',
      filePath,
      locationLabel,
      editable: false,
      description: typeof cfg.description === 'string' ? cfg.description : '',
      mode: typeof cfg.mode === 'string' ? cfg.mode : undefined,
      model: typeof cfg.model === 'string' ? cfg.model : undefined,
      temperature: typeof cfg.temperature === 'number' ? cfg.temperature : undefined,
      steps: typeof cfg.steps === 'number' ? cfg.steps : typeof cfg.maxSteps === 'number' ? cfg.maxSteps : undefined,
      color: typeof cfg.color === 'string' ? cfg.color : undefined,
      hidden: typeof cfg.hidden === 'boolean' ? cfg.hidden : undefined,
      disabled: typeof cfg.disable === 'boolean' ? cfg.disable : typeof cfg.disabled === 'boolean' ? cfg.disabled : undefined,
      prompt: typeof cfg.prompt === 'string' ? cfg.prompt : '',
      tools,
      hasGranularPermissions
    });
  }
  return out;
}

export interface ListAgentsOptions {
  runtimeAgents?: OpenCodeAgent[];
  agentToolsByAgent?: Record<string, Record<string, boolean>>;
}

export function listCustomAgents(cwd: string, options: ListAgentsOptions = {}): CustomAgent[] {
  const resolvedCwd = path.resolve(cwd);
  const found: CustomAgent[] = [];

  // 1. Project markdown agents (nearest folder first).
  for (const dir of projectConfigDirs(resolvedCwd, gitRoot(resolvedCwd))) {
    for (const sub of SCAN_SUBDIRS) {
      const folder = path.join(dir, sub);
      for (const entry of collectMarkdownFiles(folder)) {
        try {
          const raw = fs.readFileSync(entry.filePath, 'utf8');
          found.push(
            parseAgentMarkdown(raw, {
              id: entry.id,
              scope: 'project',
              filePath: entry.filePath,
              locationLabel: displayLabel(folder, resolvedCwd)
            })
          );
        } catch {
          // Ignore unreadable agent files.
        }
      }
    }
  }

  // 2. Project config-defined agents (`opencode.json(c)`).
  for (const file of projectConfigFiles(resolvedCwd, gitRoot(resolvedCwd))) {
    if (!fs.existsSync(file)) continue;
    found.push(...readConfigAgents(file, 'project', displayLabel(file, resolvedCwd)));
  }

  // 3. Global markdown agents (extra dir overrides base global dir).
  const globalDirs = [...opencodeGlobalConfigDirs()].reverse();
  for (const dir of globalDirs) {
    for (const sub of SCAN_SUBDIRS) {
      const folder = path.join(dir, sub);
      for (const entry of collectMarkdownFiles(folder)) {
        try {
          const raw = fs.readFileSync(entry.filePath, 'utf8');
          found.push(
            parseAgentMarkdown(raw, {
              id: entry.id,
              scope: 'global',
              filePath: entry.filePath,
              locationLabel: displayLabel(folder, resolvedCwd)
            })
          );
        } catch {
          // Ignore unreadable agent files.
        }
      }
    }
  }

  // 4. Global config-defined agents.
  const configFiles = new Set<string>(opencodeConfigFilePaths());
  for (const dir of opencodeGlobalConfigDirs()) {
    for (const name of [...GLOBAL_FILES, ...CONFIG_FILES]) configFiles.add(path.join(dir, name));
  }
  for (const file of [...configFiles].reverse()) {
    if (!fs.existsSync(file)) continue;
    found.push(...readConfigAgents(file, 'global', displayLabel(file, resolvedCwd)));
  }

  // Track which agent ids are already defined on disk (for shadowedBy & built-in merging).
  const primaryOwner = new Map<string, string>();
  for (const agent of found) {
    const lower = agent.id.toLowerCase();
    const owner = primaryOwner.get(lower);
    if (owner) {
      agent.shadowedBy = owner;
    } else {
      primaryOwner.set(lower, `${agent.scope} (${agent.locationLabel})`);
    }
    const resolved = options.agentToolsByAgent?.[agent.id] || options.agentToolsByAgent?.[lower];
    if (resolved) agent.resolvedTools = resolved;
  }

  // 5. Built-in / runtime agents reported by OpenCode that have no custom definition.
  for (const runtime of options.runtimeAgents || []) {
    const lower = runtime.name.toLowerCase();
    if (primaryOwner.has(lower)) continue;
    primaryOwner.set(lower, 'builtin');
    found.push({
      key: `builtin:${runtime.name}`,
      id: runtime.name,
      name: runtime.name,
      scope: 'builtin',
      sourceKind: 'builtin',
      locationLabel: 'OpenCode built-in',
      editable: false,
      description: runtime.description || '',
      prompt: '',
      tools: {},
      resolvedTools: options.agentToolsByAgent?.[runtime.name] || options.agentToolsByAgent?.[lower] || {}
    });
  }

  return found;
}

export function saveCustomAgent(cwd: string, input: SaveAgentInput): CustomAgent {
  const id = input.id.trim();
  if (!isValidAgentId(id)) {
    throw new Error('Agent name must start with a letter or digit and use only letters, digits, ., _, -, or /');
  }
  const scope: 'project' | 'global' = input.scope === 'global' ? 'global' : 'project';

  const oldPath = input.filePath ? assertAllowedAgentFile(cwd, input.filePath) : undefined;
  let targetPath: string;
  if (oldPath) {
    const oldStem = path.basename(oldPath, '.md');
    const oldIsProject = projectConfigDirs(path.resolve(cwd), gitRoot(path.resolve(cwd))).some((dir) =>
      isInsideDir(oldPath, dir)
    );
    const oldScope: 'project' | 'global' = oldIsProject ? 'project' : 'global';
    const sameId = !id.includes('/') && oldStem === id;
    if (sameId && oldScope === scope) {
      targetPath = oldPath;
    } else {
      targetPath = path.join(defaultAgentWriteDir(cwd, scope), `${id}.md`);
    }
  } else {
    targetPath = path.join(defaultAgentWriteDir(cwd, scope), `${id}.md`);
  }

  assertAllowedAgentFile(cwd, targetPath);
  if (targetPath !== oldPath && fs.existsSync(targetPath)) {
    throw new Error(`An agent named "${id}" already exists at ${targetPath}`);
  }

  const content =
    typeof input.rawMarkdown === 'string'
      ? input.rawMarkdown
      : serializeAgentMarkdown({
          description: input.description,
          mode: input.mode,
          model: input.model,
          temperature: input.temperature,
          steps: input.steps,
          color: input.color,
          hidden: input.hidden,
          disabled: input.disabled,
          tools: input.tools,
          prompt: input.prompt,
          extraFrontmatter: input.extraFrontmatter
        });

  writeAtomic(targetPath, content);
  if (oldPath && oldPath !== targetPath) {
    fs.rmSync(oldPath, { force: true });
  }

  const dir = path.dirname(targetPath);
  return parseAgentMarkdown(content, {
    id,
    scope,
    filePath: targetPath,
    locationLabel: displayLabel(dir, path.resolve(cwd))
  });
}

export function toggleCustomAgentTool(
  cwd: string,
  filePath: string,
  rule: string,
  enabled: boolean | null
): CustomAgent {
  const resolved = assertAllowedAgentFile(cwd, filePath);
  const raw = fs.readFileSync(resolved, 'utf8');
  const parsed = parseFrontmatter(raw);
  const { tools } = extractAgentToolsFromFrontmatter(parsed.data);
  const nextTools = setAgentToolRule(tools, rule, enabled);

  const isProject = projectConfigDirs(path.resolve(cwd), gitRoot(path.resolve(cwd))).some((dir) =>
    isInsideDir(resolved, dir)
  );
  const scope: 'project' | 'global' = isProject ? 'project' : 'global';
  const id = path.basename(resolved, '.md');
  const current = parseAgentMarkdown(raw, {
    id,
    scope,
    filePath: resolved,
    locationLabel: displayLabel(path.dirname(resolved), path.resolve(cwd))
  });
  const cleanedExtra = cleanPermissionConflict(current.extraFrontmatter, rule);
  const content = serializeAgentMarkdown({
    description: current.description,
    mode: current.mode,
    model: current.model,
    temperature: current.temperature,
    steps: current.steps,
    color: current.color,
    hidden: current.hidden,
    disabled: current.disabled,
    tools: nextTools,
    prompt: current.prompt,
    extraFrontmatter: cleanedExtra
  });

  writeAtomic(resolved, content);
  return parseAgentMarkdown(content, {
    id,
    scope,
    filePath: resolved,
    locationLabel: current.locationLabel
  });
}

export function deleteCustomAgent(cwd: string, filePath: string): void {
  const resolved = assertAllowedAgentFile(cwd, filePath);
  if (!fs.existsSync(resolved)) throw new Error('Agent file not found');
  fs.unlinkSync(resolved);
}
