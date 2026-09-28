import { BoardNotification, mergeInbox } from '../../../shared/notifications/inbox';

/**
 * The inbox, kept in this browser's localStorage so it survives a reload.
 * Anything that does not look like an inbox row is dropped on the way in.
 */

const INBOX_KEY = 'agent-master-3000:inbox';

function isInboxItem(value: unknown): value is BoardNotification {
  if (!value || typeof value !== 'object') return false;
  const item = value as BoardNotification;
  return (
    typeof item.id === 'string' &&
    typeof item.event === 'string' &&
    typeof item.taskId === 'string' &&
    typeof item.taskTitle === 'string' &&
    typeof item.createdAt === 'number' &&
    typeof item.read === 'boolean'
  );
}

export function loadInbox(): BoardNotification[] {
  try {
    const raw = localStorage.getItem(INBOX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return mergeInbox(parsed.filter(isInboxItem), []);
  } catch {
    return [];
  }
}

export function saveInbox(items: BoardNotification[]): void {
  try {
    localStorage.setItem(INBOX_KEY, JSON.stringify(items));
  } catch {
    /* Quota or a locked store — the inbox still lives in memory this session. */
  }
}
