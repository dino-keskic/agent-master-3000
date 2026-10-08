import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { isOpencodeAcp, parseOpencodeVersion, policyDelivery, policyDocument, policyFilePath } from '../../shared/toolCatalog/policyDelivery.js';
import { DEFAULT_FILE_PATH } from '../board/stateFile.js';
import { opencodeBin } from '../setup/locations.js';

/**
 * The board's own OpenCode config file, which carries its tool switches to an
 * OpenCode 2 that watches it (`shared/toolCatalog/policyDelivery.ts` says why
 * and when), and the version check that decides whether to use it.
 *
 * What belongs here: the I/O for that — asking OpenCode its version, writing
 * the file. Both the agent process and the Tools panel's server ask here, so
 * the two resolve the same list.
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
    // Not answering is the same as 1.x: the frozen overlay works everywhere.
  }
  versions.set(key, version);
  return version;
}

export function boardPolicyFile(): string {
  return policyFilePath(DEFAULT_FILE_PATH);
}

/**
 * Write the policy to the board's file, through a temp file and a rename so
 * OpenCode's watcher never reads half of it. A file that already says this is
 * left alone: every write is a reload in every OpenCode watching it.
 */
export function writeBoardPolicyFile(policy: Record<string, boolean> | undefined, file = boardPolicyFile()): void {
  const body = policyDocument(policy);
  try {
    if (fs.readFileSync(file, 'utf8') === body) return;
  } catch {
    // Not there yet.
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, file);
}

/**
 * The board's file, written with `policy`, when the OpenCode at `bin` is one
 * that watches it — else undefined, and the policy goes into the process
 * frozen. A file that cannot be written falls back the same way.
 */
export function livePolicyFile(
  bin: string,
  env: NodeJS.ProcessEnv,
  policy: Record<string, boolean> | undefined
): string | undefined {
  if (policyDelivery(opencodeVersion(bin, env), env) !== 'file') return undefined;
  const file = boardPolicyFile();
  try {
    writeBoardPolicyFile(policy, file);
    return file;
  } catch (e) {
    console.warn(`[tools] Could not write ${file}; tool switches will need an agent restart:`, e);
    return undefined;
  }
}

/** `livePolicyFile` for the agent process, which may not be OpenCode at all. */
export function agentPolicyFile(
  bin: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  policy: Record<string, boolean> | undefined
): string | undefined {
  return isOpencodeAcp(bin, args, opencodeBin()) ? livePolicyFile(bin, env, policy) : undefined;
}
