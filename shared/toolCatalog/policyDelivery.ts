import path from 'path';
import { boardConfigOverlay } from '../agent/tools.js';

/**
 * How the board's tool switches reach OpenCode: frozen into the process, or in
 * a file it keeps watching.
 *
 * - `content`: `OPENCODE_CONFIG_CONTENT`, read once at start. It outranks every
 *   config file, on 1.x and 2.x alike, but a change needs a new agent process.
 * - `file`: a config file of the board's own, named by `OPENCODE_CONFIG`.
 *   OpenCode 2 watches its config files and a running session takes the new
 *   tool list on its next turn, so a switch applies without a restart. 1.x
 *   reads the file once, like the content, and so gains nothing from it.
 *
 * The file is not free: OpenCode 2 merges it before the project's own config,
 * so a project that says otherwise about a tool has the last word over the
 * board (verified on 2.0.24 in the sandbox). `opencodeV2.ts` reads which
 * documents came after it so the panel can say so, instead of showing a
 * switch that did nothing.
 *
 * What belongs here: deciding the delivery and what the file says. Probing
 * the version and writing the file is `server/opencode/policyFile.ts`.
 */

export type PolicyDelivery = 'content' | 'file';

/** `opencode v2.0.24` (2.x) or `1.18.32` (1.x), as `opencode --version` prints them. */
export function parseOpencodeVersion(output: string): string | undefined {
  return /\bv?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/.exec(output.trim())?.[1];
}

/**
 * The file only when it can be watched — OpenCode 2 or later — and when
 * `OPENCODE_CONFIG` is free: the user's own file there is theirs, and there is
 * only the one variable.
 */
export function policyDelivery(version: string | undefined, env: { OPENCODE_CONFIG?: string }): PolicyDelivery {
  const major = Number(version?.split('.')[0]);
  return major >= 2 && !env.OPENCODE_CONFIG ? 'file' : 'content';
}

/**
 * The board's OpenCode file, beside its state file, so a scratch board
 * (`board_state.scratch.json`) never switches the tools of the board the
 * developer is working in.
 */
export function policyFilePath(stateFile: string): string {
  const { dir, name } = path.parse(stateFile);
  return path.join(dir, `${name}.opencode.json`);
}

/**
 * Whether an agent command is OpenCode's `acp`, which is the only one worth
 * asking its version: a stub agent (`node fake-agent.mjs`) answers
 * `--version` with node's own, which reads as a 22.x that watches nothing.
 */
export function isOpencodeAcp(bin: string, args: string[], opencodeBin: string): boolean {
  if (bin === opencodeBin) return true;
  return path.basename(bin).startsWith('opencode') && args[0] === 'acp';
}

/** The file's contents: the same `tools` overlay the content would carry, or nothing. */
export function policyDocument(policy: Record<string, boolean> | undefined): string {
  return `${JSON.stringify(boardConfigOverlay(policy), null, 2)}\n`;
}
