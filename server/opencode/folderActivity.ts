import { FolderActivity } from '../../shared/setup/onboarding.js';
import { readDb } from './db.js';

/**
 * Where the user has been working with OpenCode: every folder with root
 * sessions in it, how many, and when last — what a new board offers as its
 * first project. One grouped read of the session table; the message table,
 * which is where the database's size lives, is never touched.
 */

interface ActivityRow {
  directory: string | null;
  worktree: string | null;
  sessions: number;
  lastActive: number | null;
}

export function listFolderActivity(): FolderActivity[] {
  const db = readDb();
  if (!db) return [];
  try {
    const rows = db.prepare(`
      SELECT s.directory AS directory, p.worktree AS worktree,
             COUNT(*) AS sessions, MAX(s.time_updated) AS lastActive
      FROM session s LEFT JOIN project p ON p.id = s.project_id
      WHERE s.time_archived IS NULL AND s.parent_id IS NULL
        AND IFNULL(s.title, '') NOT LIKE '%subagent%'
      GROUP BY s.directory, p.worktree
    `).all() as unknown as ActivityRow[];
    return rows
      .filter((row) => !!row.directory)
      .map((row) => ({
        directory: row.directory as string,
        worktree: row.worktree || undefined,
        sessions: Number(row.sessions) || 0,
        lastActive: Number(row.lastActive) || 0
      }));
  } catch (e) {
    console.warn('[OpenCode DB] folder activity failed:', e);
    return [];
  }
}
