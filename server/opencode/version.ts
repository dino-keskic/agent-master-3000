import { execFileSync } from 'child_process';
import fs from 'fs';
import { parseOpencodeVersion } from '../../shared/toolCatalog/policyDelivery.js';

/**
 * Which OpenCode an executable is, asked of it once. Several things decide how
 * OpenCode is started by its major version — the tool policy's delivery
 * (`policyFile.ts`), the config folder (`setup/configOverlay.ts`) — and they
 * share this answer.
 */

const VERSION_TIMEOUT_MS = 5_000;

/** Versions by executable and its mtime, so an upgrade in place is noticed. */
const versions = new Map<string, string | undefined>();

/**
 * `opencode --version`, once per executable. Synchronous on purpose: the
 * answer decides how the agent is started, and it is asked just before that —
 * tens of milliseconds on 2.x, a few hundred on 1.x, once.
 */
export function opencodeVersion(bin: string, env: NodeJS.ProcessEnv): string | undefined {
  let key = bin;
  try {
    key = `${bin}\0${fs.statSync(bin).mtimeMs}`;
  } catch {
    // A bare name to look up on PATH: the name is the key.
  }
  if (versions.has(key)) return versions.get(key);
  let version: string | undefined;
  try {
    const out = execFileSync(bin, ['--version'], {
      env,
      encoding: 'utf8',
      timeout: VERSION_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    version = parseOpencodeVersion(out);
  } catch {
    // Not answering is treated as 1.x, whose way of starting works everywhere.
  }
  versions.set(key, version);
  return version;
}
