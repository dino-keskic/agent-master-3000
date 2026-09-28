import fs from 'fs';
import os from 'os';
import path from 'path';
import { SlashCommand, dedupeSlashCommands, sortSlashCommands } from '../../shared/composer/slashCommands.js';
import { errorMessage } from '../../shared/errors.js';
import { opencodeGlobalConfigDirs } from '../setup/locations.js';

const CACHE_TTL_MS = 30_000;
const MAX_DEPTH = 3;

/**
 * OpenCode's own commands, and the skills it can reach for, read off disk.
 *
 * ACP only announces these once a session exists, and the board's header
 * composer writes the prompt that *creates* the session — so the menu has to be
 * able to answer before there is anything to ask.
 */

interface Frontmatter {
  [key: string]: string;
}

/** Just enough YAML for the `key: value` frontmatter these files actually use. */
function frontmatter(text: string): Frontmatter {
  if (!text.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  if (end < 0) return {};
  const out: Frontmatter = {};
  for (const line of text.slice(3, end).split('\n')) {
    const match = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    out[match[1]!.toLowerCase()] = match[2]!.trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function readHead(file: string, bytes = 4_000): string {
  try {
    const handle = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(bytes);
      const read = fs.readSync(handle, buffer, 0, bytes, 0);
      return buffer.subarray(0, read).toString('utf8');
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    return '';
  }
}

function firstProse(text: string): string {
  const body = text.startsWith('---') ? text.slice(text.indexOf('\n---', 3) + 4) : text;
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('<!--')) return trimmed.slice(0, 120);
  }
  return '';
}

/** `command/git/review.md` is invoked as `/git/review`, the way OpenCode nests them. */
function markdownFiles(root: string, depth = 0, prefix = ''): { name: string; file: string }[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: { name: string; file: string }[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (depth < MAX_DEPTH) found.push(...markdownFiles(full, depth + 1, `${prefix}${entry.name}/`));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      found.push({ name: `${prefix}${entry.name.slice(0, -3)}`, file: full });
    }
  }
  return found;
}

function skillDirs(root: string): { name: string; file: string }[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: { name: string; file: string }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const file = path.join(root, entry.name, 'SKILL.md');
    if (fs.existsSync(file)) found.push({ name: entry.name, file });
  }
  return found;
}

type Source = 'project' | 'global';

function toSlashCommand(
  entry: { name: string; file: string },
  kind: 'command' | 'skill',
  source: Source
): SlashCommand {
  const text = readHead(entry.file);
  const meta = frontmatter(text);
  const label = (kind === 'skill' && meta.name) || entry.name;
  return {
    id: `${kind}:${source}:${label}`,
    label,
    description: meta.description || firstProse(text) || (kind === 'skill' ? 'Skill' : 'Command'),
    kind,
    source,
    insert: `/${label} `
  };
}

/** Every layout the agent loads these from, in the order it resolves them. */
function roots(cwd: string | undefined): { dir: string; source: Source }[] {
  const home = os.homedir();
  const dirs: { dir: string; source: Source }[] = [];
  if (cwd) {
    dirs.push({ dir: path.join(cwd, '.opencode'), source: 'project' });
    dirs.push({ dir: path.join(cwd, '.claude'), source: 'project' });
  }
  // OpenCode's global folder and, when one is set, the extra one — it loads both.
  for (const dir of opencodeGlobalConfigDirs()) dirs.push({ dir, source: 'global' });
  dirs.push({ dir: path.join(home, '.claude'), source: 'global' });
  return dirs;
}

function scan(cwd: string | undefined): SlashCommand[] {
  const found: SlashCommand[] = [];
  for (const { dir, source } of roots(cwd)) {
    // OpenCode uses the singular folder names; the Claude layout uses plurals.
    for (const name of ['command', 'commands']) {
      for (const entry of markdownFiles(path.join(dir, name))) {
        found.push(toSlashCommand(entry, 'command', source));
      }
    }
    for (const name of ['skill', 'skills']) {
      for (const entry of skillDirs(path.join(dir, name))) {
        found.push(toSlashCommand(entry, 'skill', source));
      }
    }
  }
  return found;
}

const BUILTIN: SlashCommand[] = [
  {
    id: 'builtin:compact',
    label: 'compact',
    description: 'Summarize the conversation so far and keep going',
    kind: 'command',
    source: 'builtin',
    insert: '/compact '
  },
  {
    id: 'builtin:init',
    label: 'init',
    description: 'Write or refresh AGENTS.md for this repo',
    kind: 'command',
    source: 'builtin',
    insert: '/init '
  }
];

interface CommandCache {
  at: number;
  commands: SlashCommand[];
}

const cache = new Map<string, CommandCache>();

export function listAgentCommands(cwd?: string): { commands: SlashCommand[]; error?: string } {
  const key = cwd || '';
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { commands: hit.commands };
  try {
    const commands = sortSlashCommands(dedupeSlashCommands([...BUILTIN, ...scan(cwd)]));
    cache.set(key, { at: Date.now(), commands });
    return { commands };
  } catch (e) {
    return { commands: BUILTIN, error: errorMessage(e) || 'Could not read commands' };
  }
}
