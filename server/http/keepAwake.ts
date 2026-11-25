/**
 * Prevents macOS idle sleep (`caffeinate -i -w <pid>`) while phone remote
 * access is enabled so an external device can keep driving sessions reliably.
 */

import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';

export interface KeepAwakeHandle {
  readonly supported: boolean;
  isActive(): boolean;
  start(): boolean;
  stop(): void;
}

const CAFFEINATE_BIN = '/usr/bin/caffeinate';

function isCaffeinateAvailable(): boolean {
  if (process.platform !== 'darwin') return false;
  try {
    fs.accessSync(CAFFEINATE_BIN, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Creates a macOS `caffeinate` controller (or a no-op handle on unsupported OSes). */
export function createKeepAwakeHandle(): KeepAwakeHandle {
  if (!isCaffeinateAvailable()) {
    return {
      supported: false,
      isActive: () => false,
      start: () => false,
      stop: () => {}
    };
  }

  let child: ChildProcess | null = null;

  return {
    supported: true,

    isActive(): boolean {
      return child !== null && child.exitCode === null && !child.killed;
    },

    start(): boolean {
      if (child !== null && child.exitCode === null && !child.killed) {
        return true;
      }
      try {
        // `-i` blocks idle system sleep while still letting the Mac's display sleep;
        // `-w <pid>` exits automatically if the board process terminates unexpectedly.
        const proc = spawn(CAFFEINATE_BIN, ['-i', '-w', String(process.pid)], {
          stdio: 'ignore'
        });
        proc.unref();
        child = proc;
        proc.on('exit', () => {
          if (child === proc) child = null;
        });
        proc.on('error', () => {
          if (child === proc) child = null;
        });
        return true;
      } catch {
        child = null;
        return false;
      }
    },

    stop(): void {
      if (!child) return;
      const proc = child;
      child = null;
      try {
        proc.kill('SIGTERM');
      } catch {
        // Ignore cleanup errors if caffeinate already exited.
      }
    }
  };
}
