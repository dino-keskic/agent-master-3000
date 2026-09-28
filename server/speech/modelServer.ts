import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { SpeechStatus } from '../../shared/composer/dictation.js';
import { dataDir } from '../app/appPaths.js';

/**
 * A local speech model kept warm in a child process — the part every engine
 * shares, whichever model it runs.
 *
 * Loading a model onto the GPU takes seconds and a process per clip would pay
 * that every time, so one server is started on the first press of a mic
 * button, answers every clip after that, and is stopped again after a stretch
 * of silence to hand its memory back. It never outlives the board: a normal
 * exit, a `tsx watch` restart and a SIGKILL'd board (via the pid file, on the
 * next start) all take it down.
 *
 * An engine says only how to check for its tools, how to launch its server,
 * and how to send it a clip. Env: `SPEECH_IDLE_MINUTES` (default 20).
 */

const IDLE_MS = Math.max(1, Number(process.env.SPEECH_IDLE_MINUTES) || 20) * 60_000;

const SEARCH_PATH = [
  ...(process.env.PATH || '').split(path.delimiter),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  path.join(os.homedir(), '.local', 'bin'),
  path.join(os.homedir(), '.cargo', 'bin')
];

/** An executable by name — the board is often started without a login shell's PATH. */
export function findExecutable(name: string, override?: string): string | undefined {
  if (override) return override;
  for (const dir of SEARCH_PATH) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return undefined;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => (address && typeof address === 'object' ? resolve(address.port) : reject(new Error('No port'))));
    });
  });
}

export interface Launch {
  command: string;
  args: string[];
  /** The model's name, for the status and the log. */
  model: string;
  /** Answers 200 once the model is loaded and the server takes clips. */
  healthPath: string;
  /** A first run may be installing packages or downloading gigabytes. */
  startTimeoutMs: number;
  env?: NodeJS.ProcessEnv;
}

export abstract class LocalModelServer {
  protected status: SpeechStatus = { state: 'idle' };
  private port = 0;
  private child?: ChildProcess;
  private starting?: Promise<void>;
  private idleTimer?: NodeJS.Timeout;
  private exitHooked = false;
  private readonly pidFile: string;

  constructor(private readonly label: string) {
    this.pidFile = path.join(dataDir(), `${label}.pid`);
  }

  /** `idle` with the model it would load, or `unavailable` with what to install. Called on every status read. */
  protected abstract check(): SpeechStatus;
  /** Find or fetch the model, and say how to run a server on `port`. */
  protected abstract prepare(port: number): Promise<Launch>;
  /** One clip to the running server, back as prompt text. */
  protected abstract request(port: number, wav: Buffer): Promise<string>;
  /** The server's stderr as it arrives, e.g. to read download progress from. */
  protected onOutput(_chunk: string): void {}

  getStatus(): SpeechStatus {
    // Re-checked each time, so installing the missing tool is noticed without a restart.
    if (this.status.state === 'idle' || this.status.state === 'unavailable') this.status = this.check();
    return this.status;
  }

  /** Start loading the model without waiting for it. Called the moment a mic is pressed. */
  warm(): SpeechStatus {
    void this.ensureStarted().catch(() => undefined);
    return this.getStatus();
  }

  async transcribe(wav: Buffer): Promise<string> {
    await this.ensureStarted();
    this.touch();
    try {
      return await this.request(this.port, wav);
    } finally {
      this.touch();
    }
  }

  private ensureStarted(): Promise<void> {
    if (this.status.state === 'ready' && this.child) return Promise.resolve();
    if (!this.starting) {
      this.starting = this.start().finally(() => {
        this.starting = undefined;
      });
    }
    return this.starting;
  }

  private async start(): Promise<void> {
    const available = this.check();
    if (available.state === 'unavailable') {
      this.status = available;
      throw new Error(available.detail);
    }

    try {
      this.reapOrphan();
      this.port = await freePort();
      const launch = await this.prepare(this.port);
      if (this.status.state !== 'downloading') this.status = { state: 'starting', model: launch.model };

      const child = spawn(launch.command, launch.args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        env: launch.env ?? process.env
      });
      this.child = child;
      this.hookExit();
      if (child.pid) {
        fs.mkdirSync(path.dirname(this.pidFile), { recursive: true });
        fs.writeFileSync(this.pidFile, String(child.pid));
      }

      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderr = (stderr + text).slice(-4000);
        this.onOutput(text);
      });
      child.on('exit', (code) => {
        if (this.child !== child) return;
        this.child = undefined;
        const lastLine = stderr.trim().split(/[\r\n]+/).pop();
        this.status = code === 0 || code === null
          ? { state: 'idle', model: launch.model }
          : { state: 'error', detail: lastLine || `${this.label} exited (${code})`, model: launch.model };
      });

      await this.waitUntilUp(child, launch);
      this.status = { state: 'ready', model: launch.model };
      console.log(`[Speech] ${this.label} ready on 127.0.0.1:${this.port} with ${launch.model}`);
      this.touch();
    } catch (e) {
      const failed = this.status;
      this.stop();
      if (failed.state !== 'unavailable') {
        this.status = { state: 'error', detail: e instanceof Error ? e.message : String(e), model: failed.model };
      }
      throw e;
    }
  }

  private async waitUntilUp(child: ChildProcess, launch: Launch): Promise<void> {
    const deadline = Date.now() + launch.startTimeoutMs;
    while (Date.now() < deadline) {
      if (this.child !== child) throw new Error(this.status.detail || `${this.label} exited while starting`);
      try {
        const res = await fetch(`http://127.0.0.1:${this.port}${launch.healthPath}`, { signal: AbortSignal.timeout(1000) });
        if (res.ok) return;
      } catch {
        // not listening yet
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`${this.label} did not start in time`);
  }

  /** Kill a server left behind by a previous run of the board. */
  private reapOrphan(): void {
    try {
      const pid = Number(fs.readFileSync(this.pidFile, 'utf8'));
      if (pid > 0) process.kill(pid, 'SIGTERM');
    } catch {
      // no file, or the process is already gone
    }
    fs.rmSync(this.pidFile, { force: true });
  }

  private touch(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      console.log(`[Speech] Stopping idle ${this.label}`);
      this.stop();
    }, IDLE_MS);
    this.idleTimer.unref();
  }

  stop(): void {
    clearTimeout(this.idleTimer);
    const child = this.child;
    this.child = undefined;
    if (child && child.exitCode === null) child.kill('SIGTERM');
    fs.rmSync(this.pidFile, { force: true });
    if (this.status.state === 'ready' || this.status.state === 'starting' || this.status.state === 'downloading') {
      this.status = { state: 'idle', model: this.status.model };
    }
  }

  /**
   * The model holds gigabytes, so it must not outlive the board. `exit` covers
   * a normal shutdown; the signals are how `tsx watch` restarts us, and by
   * default Node dies on them without running `exit` handlers at all.
   */
  private hookExit(): void {
    if (this.exitHooked) return;
    this.exitHooked = true;
    process.on('exit', () => this.stop());
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
      process.once(signal, () => {
        this.stop();
        process.exit(signal === 'SIGINT' ? 130 : 143);
      });
    }
  }
}
