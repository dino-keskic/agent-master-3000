import { execFile } from 'child_process';
import os from 'os';
import { parseShellEnv, shellEnvCommand } from '../shared/desktop/shellEnv.js';

/**
 * Asks the user's login shell for its environment, once, at launch.
 *
 * Interactive as well as login, because that is where most people export
 * PATH and their API keys (`~/.zshrc`). A profile that hangs or fails costs
 * the board its shell environment, not its start: the caller falls back to
 * the app's own. What is kept from the answer is `shared/desktop/shellEnv.ts`.
 */

/** A slow profile (nvm, conda) takes a second or two; one that waits on input never ends. */
const SHELL_TIMEOUT_MS = 10_000;

export function readShellEnv(): Promise<Record<string, string> | null> {
  const shell = process.env.SHELL || os.userInfo().shell || '/bin/zsh';
  return new Promise((resolve) => {
    execFile(
      shell,
      ['-ilc', shellEnvCommand()],
      // DISABLE_AUTO_UPDATE: oh-my-zsh would otherwise ask whether to update, and wait.
      { timeout: SHELL_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, DISABLE_AUTO_UPDATE: 'true' } },
      (error, stdout) => {
        const env = parseShellEnv(stdout);
        if (!env) console.warn(`[Desktop] Could not read the ${shell} environment:`, error?.message ?? 'no output');
        resolve(env);
      }
    );
  });
}
