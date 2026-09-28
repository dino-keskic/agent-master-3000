import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';
import { opencodeDbPath } from '../setup/locations.js';

/** Where OpenCode keeps its sessions — `OPENCODE_DB`, the setup file, or OpenCode's own default. */
function dbPath(): string {
  return opencodeDbPath();
}

/** Exported so every reader of the OpenCode DB honours the same path override and the same "no DB is still a working board" contract. */
export function openDb(readOnly = true): DatabaseSync | null {
  const file = dbPath();
  if (!fs.existsSync(file)) return null;
  try {
    return new DatabaseSync(file, { readOnly });
  } catch (e) {
    console.warn('[OpenCode DB] Could not open', file, e);
    return null;
  }
}

/**
 * One long-lived read handle, shared by every reader.
 *
 * Opening the OpenCode database is not free: it is a WAL database that runs to
 * tens of gigabytes, and each `new DatabaseSync` pays for the header read and
 * then throws away its page cache on close. The poll loop was doing that
 * roughly eight times every four seconds, so the cache never survived long
 * enough to be worth anything.
 *
 * A WAL reader sees every commit that lands after it opened — each statement
 * starts its own read transaction — so holding the handle costs no freshness,
 * and read-only means it can never block the writer.
 */
let sharedDb: DatabaseSync | null = null;
let sharedDbFile: string | null = null;

export function readDb(): DatabaseSync | null {
  const file = dbPath();
  // A changed OPENCODE_DB, or a database swapped underneath us, has to win
  // over the cached handle rather than being served stale forever.
  if (sharedDb && sharedDbFile !== file) closeReadDb();
  if (sharedDb) return sharedDb;
  const db = openDb(true);
  if (!db) return null;
  sharedDb = db;
  sharedDbFile = file;
  return sharedDb;
}

/** Drop the shared handle — on shutdown, or after a read fails hard enough to suspect the connection. */
export function closeReadDb(): void {
  const db = sharedDb;
  sharedDb = null;
  sharedDbFile = null;
  if (db) {
    try { db.close(); } catch { /* ignore */ }
  }
}

/** Cheap existence check — no git, so listing thousands of sessions stays fast. */
export function directoryExists(dir: string): boolean {
  if (!dir) return false;
  try {
    return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

export function toIso(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return '';
  return new Date(ms).toISOString();
}
