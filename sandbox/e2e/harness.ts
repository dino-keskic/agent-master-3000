import { ChildProcess, execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TaskLogItem } from '../../shared/types.js';
import { MODEL_ID, PROVIDER_ID } from './stubLlm.js';

/**
 * What every sandbox e2e needs: a workspace, OpenCode's and the board's config
 * pointing at the stub LLM, and a board server to start, stop and call.
 *
 * Importing it refuses to run outside the sandbox container: a board started
 * on a host would start the host's `opencode`, which AGENTS.md forbids.
 */

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MODEL = `${PROVIDER_ID}/${MODEL_ID}`;
export const TURN_TIMEOUT_MS = 60_000;

if (process.env.ACP_E2E !== '1' || !fs.existsSync('/.dockerenv')) {
  throw new Error('The OpenCode e2e only runs inside the sandbox container: npm run sandbox:e2e');
}

/** Polls `check` until it returns something, or fails naming what it waited for. */
export async function waitFor<T>(what: string, check: () => T | undefined | Promise<T | undefined>, timeoutMs = TURN_TIMEOUT_MS): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * OpenCode's config for the run: the stub as the only provider, and the shell
 * set to ask, so a tool call has to go through the board's permission prompt.
 * 1.x calls it `bash`, 2.x `shell`; each ignores the other's name.
 */
export function writeOpenCodeConfig(dir: string, stubPort: number): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'opencode.json'), JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    model: MODEL,
    small_model: MODEL,
    autoupdate: false,
    share: 'disabled',
    permission: { bash: 'ask', shell: 'ask' },
    provider: {
      [PROVIDER_ID]: {
        npm: '@ai-sdk/openai-compatible',
        name: 'E2E stub',
        options: { baseURL: `http://127.0.0.1:${stubPort}/v1`, apiKey: 'e2e' },
        models: {
          [MODEL_ID]: { name: 'E2E stub model', tool_call: true, limit: { context: 100000, output: 4096 } }
        }
      }
    }
  }, null, 2));
}

/**
 * A board that already knows the workspace as a project and the stub as its
 * default model — what a user would have set up — so the session list reads
 * OpenCode's DB for that folder and startup does not ask for a model that is
 * not there.
 */
export function writeBoardState(file: string, workspace: string): void {
  fs.writeFileSync(file, JSON.stringify({
    tasks: [],
    nextTaskNumber: 0,
    settings: {
      defaultModel: MODEL,
      defaultCwd: workspace,
      projects: [{ id: 'proj-e2e', name: 'web-app', path: workspace, createdAt: Date.now() }]
    }
  }, null, 2));
}

/** A small git repo for the session to work in, the way a real project folder is. */
export function makeWorkspace(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), '# e2e workspace\n');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('-c', 'user.name=Ada Lovelace', '-c', 'user.email=ada@example.com', 'add', '.');
  git('-c', 'user.name=Ada Lovelace', '-c', 'user.email=ada@example.com', 'commit', '-q', '-m', 'init');
}

export interface Board {
  url: string;
  output: () => string;
  /** SIGTERM by default; SIGINT is a Ctrl-C in the terminal the board runs in. */
  stop: (signal?: NodeJS.Signals) => Promise<void>;
}

export async function startBoard(env: NodeJS.ProcessEnv): Promise<Board> {
  const port = await freePort();
  let output = '';
  // Its own process group, so stopping it takes the `opencode acp` child too.
  const entry = process.env.ACP_E2E_BUNDLE === '1' ? ['bin/agent-master-3000.mjs'] : ['--import', 'tsx', 'server/index.ts'];
  const child: ChildProcess = spawn(process.execPath, entry, {
    cwd: REPO,
    env: { ...env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true
  });
  child.stdout?.on('data', (d: Buffer) => { output += d.toString(); });
  child.stderr?.on('data', (d: Buffer) => { output += d.toString(); });

  const url = `http://127.0.0.1:${port}`;
  await waitFor('the board server to listen', async () => {
    if (child.exitCode !== null) throw new Error(`board server exited early:\n${output}`);
    const ok = await fetch(`${url}/api/board`).then((r) => r.ok, () => false);
    return ok || undefined;
  }, 30_000);

  return {
    url,
    output: () => output,
    stop: async (signal = 'SIGTERM') => {
      if (child.exitCode !== null || !child.pid) return;
      const exited = new Promise((r) => child.once('exit', r));
      try { process.kill(-child.pid, signal); } catch { /* gone */ }
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ }
    }
  };
}

export async function api<T>(board: Board, method: string, route: string, body?: unknown): Promise<T> {
  const res = await fetch(`${board.url}${route}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${route} → ${res.status}: ${text}`);
  return JSON.parse(text) as T;
}

/** Every text-bearing log the transcript holds, joined, for substring checks. */
export function transcriptText(logs: TaskLogItem[]): string {
  return logs.map((log) => `${log.type}: ${log.text}`).join('\n');
}

/**
 * The board's environment for one run, everything under `root`: HOME, OpenCode's
 * config (the stub as the only provider) and database, the board's state.
 */
export function boardEnvFor(root: string, workspace: string, stubPort: number, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const home = path.join(root, 'home');
  const configDir = path.join(root, 'opencode-config');
  writeOpenCodeConfig(configDir, stubPort);
  // OpenCode creates the DB file but not the folder it is in.
  const dbFile = path.join(root, 'opencode', 'opencode.db');
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const stateFile = path.join(root, 'board_state.json');
  writeBoardState(stateFile, workspace);
  return {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_STATE_HOME: path.join(home, '.local', 'state'),
    OPENCODE_CONFIG_DIR: configDir,
    // One path for both: OpenCode writes here and the board reads it.
    OPENCODE_DB: dbFile,
    // Nothing to reach anyway — the container has no network — but asking
    // costs a failed request and an error in the log on every start.
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    OPENCODE_DISABLE_MODELS_FETCH: '1',
    OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
    OPENCODE_DISABLE_SHARE: '1',
    BOARD_STATE_FILE: stateFile,
    BOARD_ATTACHMENTS_DIR: path.join(root, 'attachments'),
    ...extra
  };
}
