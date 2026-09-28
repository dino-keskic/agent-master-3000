import { ToolCallStatus } from '../types.js';

/**
 * Tool-call normalization shared by both ingest paths — live ACP events
 * (server/acpClient) and history replayed from the OpenCode DB
 * (server/opencode). Keeping one implementation is what stops an imported
 * session and a live session from classifying the same tool differently.
 */

/** ACP `kind` values the board understands. */
export type ToolKind = 'read' | 'edit' | 'execute' | 'search' | 'fetch' | 'other';

const KIND_BY_TOOL: Record<string, ToolKind> = {
  read: 'read',
  edit: 'edit',
  write: 'edit',
  apply_patch: 'edit',
  patch: 'edit',
  bash: 'execute',
  execute: 'execute',
  shell: 'execute',
  glob: 'search',
  grep: 'search',
  search: 'search',
  fetch: 'fetch',
  web: 'fetch',
  webfetch: 'fetch'
};

export function toolKind(name: string): ToolKind {
  return KIND_BY_TOOL[name.trim().toLowerCase()] ?? 'other';
}

/**
 * Tools that hand the work to a child session instead of doing it inline.
 * OpenCode spells it `task`. Both the transcript link and the tool-call UI key
 * off this, so the spelling lives in one place.
 */
const SUBAGENT_TOOLS: ReadonlySet<string> = new Set(['task', 'agent', 'subagent']);

export function isSubagentTool(name: string | undefined): boolean {
  return SUBAGENT_TOOLS.has((name || '').trim().toLowerCase());
}

/**
 * ACP and the OpenCode DB spell failure differently ('failed' vs 'error') and
 * omit status entirely for historical rows.
 */
export function normalizeToolStatus(status: unknown): ToolCallStatus | undefined {
  switch (status) {
    case 'pending':
    case 'in_progress':
    case 'completed':
      return status;
    case 'running':
      return 'in_progress';
    case 'failed':
    case 'error':
      return 'failed';
    default:
      return undefined;
  }
}

/** Replayed history is finished by definition, so absent status means completed. */
export function replayedToolStatus(status: unknown): ToolCallStatus {
  return normalizeToolStatus(status) ?? 'completed';
}

/**
 * A short display label. ACP sends either a real tool name ("read") or a
 * sentence-like title ("Reading src/App.tsx"); only the former is a label.
 */
export function toolLabel(title: unknown, kind: unknown): string {
  const isLabel =
    typeof title === 'string' &&
    title.length > 0 &&
    title.length <= 24 &&
    !title.includes('/') &&
    !title.includes(' ');
  if (isLabel) return title;
  return (typeof kind === 'string' && kind) || 'tool';
}
