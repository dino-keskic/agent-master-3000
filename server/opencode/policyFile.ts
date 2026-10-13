import fs from 'fs';
import path from 'path';
import { isOpencodeAcp, policyDelivery, policyDocument, policyFilePath } from '../../shared/toolCatalog/policyDelivery.js';
import { DEFAULT_FILE_PATH } from '../board/stateFile.js';
import { opencodeBin } from '../setup/locations.js';
import { opencodeVersion } from './version.js';

/**
 * The board's own OpenCode config file, which carries its tool switches to an
 * OpenCode 2 that watches it (`shared/toolCatalog/policyDelivery.ts` says why
 * and when).
 *
 * What belongs here: the I/O for that — deciding by `version.ts`'s answer,
 * writing the file. Both the agent process and the Tools panel's server ask
 * here, so the two resolve the same list.
 */

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
