import { PendingPermission, PermissionMode, PermissionOptionKind, ToolCallInfo } from '../types.js';

/**
 * How much the board decides on the user's behalf when the agent asks for
 * permission to run a tool.
 */
export const PERMISSION_MODES: { value: PermissionMode; label: string; description: string }[] = [
  {
    value: 'auto',
    label: 'Auto-approve',
    description: 'Approve every request. Fastest, and the agent never blocks — but it can edit and run anything in the working folder.'
  },
  {
    value: 'review-writes',
    label: 'Review writes',
    description: 'Approve reads and searches automatically; ask before edits, shell commands and deletes.'
  },
  {
    value: 'manual',
    label: 'Ask every time',
    description: 'Pause on every request and wait for you.'
  }
];

export const DEFAULT_PERMISSION_MODE: PermissionMode = 'review-writes';

/** Tool kinds that only observe. Everything else can change the repo or the machine. */
const READ_ONLY_KINDS = new Set(['read', 'search', 'fetch', 'think']);

export function isReadOnlyTool(kind?: string, name?: string): boolean {
  const key = (kind || name || '').toLowerCase();
  if (!key) return false;
  if (/delete|remove|rm\b/.test(key)) return false;
  return READ_ONLY_KINDS.has(key) || /^(read|glob|grep|search|list|fetch|webfetch)$/.test(key);
}

function normalizeFolder(path: string): string | undefined {
  if (!path.startsWith('/') || path.split('/').includes('..')) return undefined;
  return path.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

function isWithin(path: string, folder: string): boolean {
  const p = normalizeFolder(path);
  const f = normalizeFolder(folder);
  if (!p || !f) return false;
  return f === '/' || p === f || p.startsWith(`${f}/`);
}

/**
 * True when the request is OpenCode's external-directory check for a file inside
 * `folder` — the folder the board runs this session in.
 *
 * OpenCode only knows the folder a session was created in. A session the board
 * moved to a worktree still reads its own files, yet every read looks "outside"
 * to OpenCode, and its "always allow" covers one directory, not the tree below.
 * The tool itself is still judged on its own afterwards.
 */
export function isAccessWithinFolder(
  toolCall: Pick<ToolCallInfo, 'rawInput'>,
  folder: string | undefined
): boolean {
  const input = toolCall.rawInput;
  if (!folder || !input) return false;
  const { parentDir, filepath } = input;
  if (typeof parentDir !== 'string' || !isWithin(parentDir, folder)) return false;
  return filepath === undefined || (typeof filepath === 'string' && isWithin(filepath, folder));
}

/**
 * Decides a request without asking, when the mode allows it.
 * `undefined` means "the user has to answer this one".
 */
export function autoDecision(
  mode: PermissionMode,
  toolCall: Pick<ToolCallInfo, 'kind' | 'name'>
): 'approve' | undefined {
  if (mode === 'auto') return 'approve';
  if (mode === 'review-writes' && isReadOnlyTool(toolCall.kind, toolCall.name)) return 'approve';
  return undefined;
}

/** Rank so the approve/reject buttons always appear in a predictable order. */
const KIND_ORDER: Partial<Record<PermissionOptionKind, number>> = {
  allow_once: 0,
  allow_always: 1,
  reject_once: 2,
  reject_always: 3
};

export function sortPermissionOptions(options: PendingPermission['options']): PendingPermission['options'] {
  return [...options].sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9));
}

export function isApproval(kind: PermissionOptionKind): boolean {
  return kind === 'allow_once' || kind === 'allow_always';
}

/** The option the board picks when it approves on the user's behalf. */
export function pickAutoApproveOption(options: PendingPermission['options']): string | undefined {
  return (
    options.find((o) => o.kind === 'allow_once')?.optionId ??
    options.find((o) => o.kind === 'allow_always')?.optionId ??
    options.find((o) => isApproval(o.kind))?.optionId
  );
}

export function pickRejectOption(options: PendingPermission['options']): string | undefined {
  return (
    options.find((o) => o.kind === 'reject_once')?.optionId ??
    options.find((o) => o.kind === 'reject_always')?.optionId
  );
}
