import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { utilityProcess, UtilityProcess } from 'electron';

/**
 * The board server, run by the desktop app.
 *
 * It is the same bundle `agent-master-3000` runs (`dist-server/cli.mjs`), in
 * an Electron utility process: Electron's own Node, so the app needs no Node
 * installed, and a process of its own, so a busy poll never stalls the
 * window. Its output goes to a log file, since a Finder-launched app has no
 * terminal to print to.
 */

/** The package root: `dist-desktop/` sits one level below it, like `dist-server/`. */
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** How long a board gets to open its port. Its first start also opens the OpenCode database. */
const START_TIMEOUT_MS = 30_000;

/** How long a quit waits for the board to save its state before ending it anyway. */
const STOP_TIMEOUT_MS = 5_000;

export interface BoardProcess {
  /** Resolves once it answers HTTP; rejects with what went wrong. */
  ready: Promise<void>;
  /** Asks it to shut down, and resolves when it has. */
  stop(): Promise<void>;
}

/** True once something answers HTTP at `origin`, whatever it says. */
export async function answers(origin: string): Promise<boolean> {
  try {
    await fetch(origin, { signal: AbortSignal.timeout(1_000) });
    return true;
  } catch {
    return false;
  }
}

/** The last lines of the log, for an error dialog. */
export function logTail(logFile: string, lines = 15): string {
  try {
    return fs.readFileSync(logFile, 'utf-8').trimEnd().split('\n').slice(-lines).join('\n');
  } catch {
    return '';
  }
}

export function startBoard(env: Record<string, string>, origin: string, logFile: string): BoardProcess {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const log = fs.createWriteStream(logFile, { flags: 'a' });
  log.write(`\n--- ${new Date().toISOString()} starting the board at ${origin}\n`);

  const child: UtilityProcess = utilityProcess.fork(path.join(APP_ROOT, 'dist-server', 'cli.mjs'), [], {
    env,
    cwd: os.homedir(),
    stdio: 'pipe',
    serviceName: 'Agent Master 3000 board'
  });
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });

  const exited = new Promise<number>((resolve) => child.once('exit', resolve));
  void exited.then((code) => log.write(`--- the board exited with code ${code}\n`));

  const ready = (async () => {
    const deadline = Date.now() + START_TIMEOUT_MS;
    let gone: number | undefined;
    void exited.then((code) => { gone = code; });
    while (Date.now() < deadline) {
      if (gone !== undefined) throw new Error(`The board stopped while starting (exit code ${gone}).`);
      if (await answers(origin)) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`The board did not start listening at ${origin} within ${START_TIMEOUT_MS / 1000} s.`);
  })();

  let stopping: Promise<void> | undefined;
  const stop = () => {
    stopping ??= (async () => {
      // SIGTERM: the board's shutdown handler saves its state and stops the agent.
      child.kill();
      const timer = new Promise<void>((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS));
      await Promise.race([exited, timer]);
      log.end();
    })();
    return stopping;
  };

  return { ready, stop };
}
