import { execFile } from 'child_process';
import fs from 'fs';
import { majorOf } from '../../shared/agent/driver.js';
import { parseServiceFile, serviceAuthHeader, type ServiceFile } from '../../shared/agent/serviceApi.js';
import { childBaseEnv, opencodeBin, opencodeServiceFile } from '../setup/locations.js';
import { opencodeVersion } from './version.js';

/**
 * Finding OpenCode 2's background service, and starting it when nobody has.
 *
 * The service is one per user, not one per board: the user's own `opencode`
 * TUI talks to the same one. So the board only ever *starts* it, and only when
 * the service file is missing or names a process that is gone — it never stops
 * or restarts it, whatever state it is in. What belongs here: reading the
 * service file, `opencode service start`, and the authenticated request. The
 * password the file holds is a credential: it goes into the `Authorization`
 * header and nowhere else — not a log line, not an error, not the client.
 */

const START_TIMEOUT_MS = 30_000;
/** How long after `service start` returns the file may take to appear. */
const FILE_WAIT_MS = 10_000;
const FILE_POLL_MS = 200;
/** A request the service takes longer than this to answer is a wedged service. */
export const SERVICE_REQUEST_TIMEOUT_MS = 30_000;

export interface ServiceConnection {
  url: string;
  /** The `Authorization` header. Never log it. */
  authorization: string;
  version?: string;
}

/** Whether a process with this pid exists. EPERM means it does, as somebody else's. */
function alive(pid: number | undefined): boolean {
  if (!pid) return true; // A file without a pid is judged by whether it answers.
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readServiceFile(): ServiceFile | undefined {
  try {
    return parseServiceFile(fs.readFileSync(opencodeServiceFile(), 'utf8'));
  } catch {
    return undefined;
  }
}

function connectionOf(file: ServiceFile): ServiceConnection {
  return { url: file.url, authorization: serviceAuthHeader(file.password), version: file.version };
}

/** True when the service at `conn` answers an authenticated request. */
async function answers(conn: ServiceConnection): Promise<boolean> {
  try {
    const res = await fetch(`${conn.url}/api/info`, {
      headers: { authorization: conn.authorization },
      signal: AbortSignal.timeout(5_000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

function startService(): Promise<void> {
  const bin = opencodeBin();
  const env = childBaseEnv(opencodeVersion(bin, process.env));
  return new Promise((resolve, reject) => {
    execFile(bin, ['service', 'start'], { env, timeout: START_TIMEOUT_MS }, (err) => {
      // Its output is not passed on: it may print where the service is and how
      // to reach it.
      if (err) reject(new Error(`Could not start OpenCode's background service (${err.message.split('\n')[0]})`));
      else resolve();
    });
  });
}

async function waitForFile(): Promise<ServiceFile | undefined> {
  const until = Date.now() + FILE_WAIT_MS;
  for (;;) {
    const file = readServiceFile();
    if (file && alive(file.pid)) return file;
    if (Date.now() >= until) return undefined;
    await new Promise((resolve) => setTimeout(resolve, FILE_POLL_MS));
  }
}

/**
 * The running service, started first if there is none. Rejects when it cannot
 * be reached, or turns out not to be OpenCode 2 — the caller then has no
 * service to drive and says so.
 */
export async function connectService(): Promise<ServiceConnection> {
  let file = readServiceFile();
  if (file && alive(file.pid) && (await answers(connectionOf(file)))) return checked(file);

  // Missing, or naming a process that is gone. One that is alive but did not
  // answer is somebody's service still starting; `service start` leaves a
  // running one alone, so asking is safe either way.
  await startService();
  file = await waitForFile();
  if (!file) throw new Error('OpenCode started its background service but did not say where it is');
  const conn = connectionOf(file);
  if (!(await answers(conn))) throw new Error('OpenCode\'s background service is not answering');
  return checked(file);
}

function checked(file: ServiceFile): ServiceConnection {
  const major = majorOf(file.version);
  if (major !== undefined && major < 2) throw new Error(`OpenCode's service is ${file.version}, not 2.x`);
  return connectionOf(file);
}

/** An error from the service, safe to show: the status and what it said, never the request headers. */
export class ServiceError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** One authenticated JSON request. Resolves to the parsed body (or undefined when empty). */
export async function serviceRequest(
  conn: ServiceConnection,
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = SERVICE_REQUEST_TIMEOUT_MS
): Promise<unknown> {
  const res = await fetch(`${conn.url}${path}`, {
    method,
    headers: {
      authorization: conn.authorization,
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const said = (parsed as { message?: string; error?: { message?: string } } | undefined);
    const message = said?.message || said?.error?.message || (typeof parsed === 'string' ? parsed.slice(0, 200) : '');
    throw new ServiceError(res.status, `OpenCode service ${method} ${path.split('?')[0]}: ${res.status}${message ? ` ${message}` : ''}`);
  }
  return parsed;
}

/** `?location[directory]=…`, the way the service takes a folder in a query. */
export function locationQuery(directory: string | undefined): string {
  return directory ? `?${new URLSearchParams({ 'location[directory]': directory })}` : '';
}
