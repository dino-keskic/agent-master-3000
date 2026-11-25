import { parseFrontmatter, serializeFrontmatter } from '../agent/frontmatter.js';

/**
 * OpenCode / Agent Skills (`SKILL.md` directories) shared model, parser,
 * serializer, and filter helpers.
 *
 * Pure: disk discovery and writes live in `server/opencode/skills.ts`.
 */

export type SkillScope = 'project' | 'global';
export type SkillLayout = 'opencode' | 'claude' | 'agents';

export interface SkillFileInfo {
  /** Path relative to the skill directory, e.g. `SKILL.md` or `references/api.md`. */
  relativePath: string;
  size: number;
  isText: boolean;
}

export interface SkillItem {
  key: string;
  name: string;
  dirName: string;
  scope: SkillScope;
  layout: SkillLayout;
  dirPath: string;
  filePath: string;
  locationLabel: string;
  shadowedBy?: string;
  description: string;
  compatibility?: string;
  license?: string;
  allowedTools?: string[];
  metadata?: Record<string, string>;
  body: string;
  rawMarkdown: string;
  files: SkillFileInfo[];
  extraFrontmatter?: Record<string, unknown>;
  /** True when disabled on the fly via the board's `skillPolicy` overlay. */
  disabled?: boolean;
}

export interface SkillInventory {
  cwd: string;
  skills: SkillItem[];
  projectDir: string;
  globalDir: string;
  skillPolicy?: Record<string, boolean>;
  pendingRestart?: boolean;
}

export interface SaveSkillInput {
  /** Existing skill directory when editing/renaming an existing skill. */
  dirPath?: string;
  name: string;
  scope: SkillScope;
  description: string;
  compatibility?: string;
  license?: string;
  allowedTools?: string[];
  metadata?: Record<string, string>;
  body: string;
  extraFrontmatter?: Record<string, unknown>;
  /** When set, writes this exact SKILL.md content instead of serializing fields. */
  rawMarkdown?: string;
}

const KNOWN_SKILL_KEYS = new Set([
  'name',
  'description',
  'compatibility',
  'license',
  'allowed-tools',
  'metadata'
]);

const PREFERRED_SKILL_ORDER = [
  'name',
  'description',
  'compatibility',
  'license',
  'allowed-tools',
  'metadata'
] as const;

export function isValidSkillName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 64) return false;
  if (trimmed === '.' || trimmed === '..' || /[/\\\0]/.test(trimmed)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(trimmed);
}

/** OpenCode's recommended kebab-case format (`^[a-z0-9]+(-[a-z0-9]+)*$`). */
export function isRecommendedSkillName(name: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name.trim());
}

export function slugifySkillName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseAllowedTools(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const list = value.map((item) => String(item).trim()).filter(Boolean);
    return list.length > 0 ? list : undefined;
  }
  if (typeof value === 'string') {
    const list = value
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    return list.length > 0 ? list : undefined;
  }
  return undefined;
}

function parseMetadata(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (val === undefined || val === null) continue;
    out[key] =
      typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean'
        ? String(val)
        : JSON.stringify(val);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function parseSkillMarkdown(
  raw: string,
  meta: {
    dirName: string;
    scope: SkillScope;
    layout: SkillLayout;
    dirPath: string;
    filePath: string;
    locationLabel: string;
    files?: SkillFileInfo[];
  }
): SkillItem {
  const { data, body } = parseFrontmatter(raw);
  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : meta.dirName;
  const extraFrontmatter: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!KNOWN_SKILL_KEYS.has(key)) extraFrontmatter[key] = value;
  }

  return {
    key: meta.filePath,
    name,
    dirName: meta.dirName,
    scope: meta.scope,
    layout: meta.layout,
    dirPath: meta.dirPath,
    filePath: meta.filePath,
    locationLabel: meta.locationLabel,
    description: typeof data.description === 'string' ? data.description : '',
    compatibility: typeof data.compatibility === 'string' && data.compatibility.trim() ? data.compatibility.trim() : undefined,
    license: typeof data.license === 'string' && data.license.trim() ? data.license.trim() : undefined,
    allowedTools: parseAllowedTools(data['allowed-tools']),
    metadata: parseMetadata(data.metadata),
    body,
    rawMarkdown: raw,
    files: meta.files || [],
    ...(Object.keys(extraFrontmatter).length > 0 ? { extraFrontmatter } : {})
  };
}

export function serializeSkillMarkdown(input: {
  name: string;
  description: string;
  compatibility?: string;
  license?: string;
  allowedTools?: string[];
  metadata?: Record<string, string>;
  body: string;
  extraFrontmatter?: Record<string, unknown>;
}): string {
  const data: Record<string, unknown> = { ...(input.extraFrontmatter || {}) };
  data.name = input.name.trim();
  if (input.description.trim()) data.description = input.description.trim();
  else delete data.description;

  if (input.compatibility?.trim()) data.compatibility = input.compatibility.trim();
  else delete data.compatibility;

  if (input.license?.trim()) data.license = input.license.trim();
  else delete data.license;

  if (input.allowedTools && input.allowedTools.length > 0) data['allowed-tools'] = input.allowedTools;
  else delete data['allowed-tools'];

  if (input.metadata && Object.keys(input.metadata).length > 0) data.metadata = input.metadata;
  else delete data.metadata;

  return serializeFrontmatter(data, input.body, PREFERRED_SKILL_ORDER);
}

export function filterSkills(skills: SkillItem[], filter: string): SkillItem[] {
  const needle = filter.trim().toLowerCase();
  if (!needle) return skills;
  return skills.filter(
    (skill) =>
      skill.name.toLowerCase().includes(needle) ||
      skill.description.toLowerCase().includes(needle) ||
      skill.locationLabel.toLowerCase().includes(needle)
  );
}

export function groupSkills(skills: SkillItem[]): {
  project: SkillItem[];
  global: SkillItem[];
} {
  const project: SkillItem[] = [];
  const global: SkillItem[] = [];
  for (const skill of skills) {
    if (skill.scope === 'project') project.push(skill);
    else global.push(skill);
  }
  return { project, global };
}
