import { execFile } from 'child_process';
import { promisify } from 'util';

/**
 * Running the ticket CLIs.
 *
 * `acli` and `gh` are the only two ways this board learns anything about a
 * ticket or a pull request, and every call in this directory goes through
 * here. Neither is required: a board without them still works, it just cannot
 * offer `@`.
 */

const execFileAsync = promisify(execFile);

/** Long enough for a cold `gh search`, short enough that a hung CLI is noticed. */
const SEARCH_TIMEOUT_MS = 12_000;

/**
 * Homebrew's bin goes on the end, not the front: it is there so a board started
 * from the Finder — with the stub PATH a GUI launch gets — can still find the
 * CLIs, and putting it first would let an installed `acli` win over one an
 * environment deliberately put ahead of it (see `tests/fixtures/cli`).
 */
export async function runJson(command: string, args: string[]): Promise<unknown> {
  const text = (await runText(command, args)).trim();
  if (!text) return null;
  return JSON.parse(text);
}

/**
 * The raw output, for the one call that is not JSON: a failed CI log. Those
 * run to megabytes and take `gh` a while to stitch together, hence the
 * bigger buffer and the longer leash when asked for.
 */
export async function runText(
  command: string,
  args: string[],
  opts: { timeoutMs?: number; maxBuffer?: number } = {}
): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    timeout: opts.timeoutMs ?? SEARCH_TIMEOUT_MS,
    maxBuffer: opts.maxBuffer ?? 4_000_000,
    env: { ...process.env, PATH: `${process.env.PATH || ''}:/opt/homebrew/bin:/usr/local/bin` }
  });
  return stdout;
}
