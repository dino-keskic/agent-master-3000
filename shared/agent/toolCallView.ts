import { ToolCallInfo } from '../types.js';
import { isExecuteTool } from './backgroundTasks.js';
import { languageFromPath } from '../transcript/highlight.js';
import { toolKind } from './toolCall.js';
import { summarizeCodeModeCalls } from './codeMode.js';

/**
 * What a tool call looks like when you show it: the one-line gist, which
 * language to colour its output as, and whether it is a shell call and so gets
 * a terminal pane instead of a JSON one.
 *
 * `toolCall.ts` next door decides what a call *is* on the way in; this decides
 * how it reads on the way out. Neither knows about React.
 */

/** The input keys worth putting on the summary line, most identifying first. */
const SUMMARY_KEYS = ['filePath', 'path', 'pattern', 'command', 'query', 'url', 'description'];
const PATH_KEYS = ['filePath', 'path'];

/** The last two segments, which is enough to tell two files apart. */
function tailOfPath(path: string): string {
  return path.split('/').slice(-2).join('/');
}

/**
 * One-line gist of what the tool is doing, so the common case needs no
 * expanding. Prefers a touched path, then the most identifying input value.
 */
export function summarizeToolCall(info: ToolCallInfo): string | null {
  if (info.locations && info.locations.length > 0) {
    const first = tailOfPath(info.locations[0] ?? '');
    return info.locations.length > 1 ? `${first} +${info.locations.length - 1} more` : first;
  }

  if (info.codeModeCalls) {
    const ran = summarizeCodeModeCalls(info.codeModeCalls);
    if (ran) return ran;
  }

  const input = info.rawInput;
  if (!input) return null;

  for (const key of SUMMARY_KEYS) {
    const value = input[key];
    if (typeof value !== 'string' || !value.trim()) continue;
    const compact = value.length > 72 ? `${value.slice(0, 72)}…` : value;
    return PATH_KEYS.includes(key) ? tailOfPath(compact) : compact;
  }
  return null;
}

/** How agents spell the tool that loads a skill: OpenCode `skill`, Claude `Skill`. */
const SKILL_TOOLS: ReadonlySet<string> = new Set(['skill', 'skills', 'use_skill', 'load_skill']);
const SKILL_NAME_KEYS = ['name', 'skill', 'skill_name', 'skillName'];

/**
 * The skill a call loaded, or undefined when it is not a skill call. A skill
 * call with no readable name still counts, and reads as an empty string, so
 * the row can mark it as a skill without inventing a name.
 */
export function skillNameOf(info: Pick<ToolCallInfo, 'name' | 'rawInput'>): string | undefined {
  if (!SKILL_TOOLS.has((info.name || '').trim().toLowerCase())) return undefined;
  for (const key of SKILL_NAME_KEYS) {
    const value = info.rawInput?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/** Drop CSI / Fe so a shell's colour codes don't print as `ESC[32m`. */
export function stripAnsi(text: string): string {
  const esc = String.fromCharCode(27);
  return text.replace(new RegExp(`${esc}(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~])`, 'g'), '');
}

export function looksLikeDiff(text: string): boolean {
  return /^(diff --git |--- |\+\+\+ |@@ )/m.test(text.slice(0, 2000));
}

/** The file this call touched, from its locations or its input. */
export function toolInputPath(info: ToolCallInfo): string | undefined {
  if (info.locations && info.locations[0]) return info.locations[0];
  const input = info.rawInput;
  if (!input) return undefined;
  for (const key of PATH_KEYS) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

/**
 * How to colour a call's output: a read shows the file's own language, and
 * anything that looks like a patch shows as a diff whatever produced it.
 */
export function toolOutputLanguage(info: ToolCallInfo): string | undefined {
  const output = info.output;
  if (!output) return undefined;

  if (toolKind(info.name) === 'read' || (info.kind || '').toLowerCase() === 'read') {
    const path = toolInputPath(info);
    return path ? languageFromPath(path) : undefined;
  }
  return looksLikeDiff(output) ? 'diff' : undefined;
}

/** Shell calls get a terminal pane, so their output reads as it was printed. */
export function isTerminalTool(info: ToolCallInfo): boolean {
  if (isExecuteTool(info)) return true;
  const key = (info.kind || info.name || '').toLowerCase();
  return key.includes('execute') || key.includes('bash') || key.includes('shell');
}

/** The rest of an input once the keys already shown are taken out. */
export function omitKeys(
  input: Record<string, unknown>,
  omit: string[]
): Record<string, unknown> | null {
  const extra = Object.fromEntries(Object.entries(input).filter(([key]) => !omit.includes(key)));
  return Object.keys(extra).length > 0 ? extra : null;
}
