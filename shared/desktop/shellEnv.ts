/**
 * The environment the desktop app starts the board with.
 *
 * A Mac app opened from the Finder or the Dock inherits launchd's bare
 * environment — PATH is `/usr/bin:/bin:/usr/sbin:/sbin` — not the one a
 * terminal has. Without the shell's environment the board cannot find
 * `opencode`, `ffmpeg` or Homebrew's git, and OpenCode starts without the
 * provider keys a profile exports. So the app asks the user's login shell for
 * its environment once, and everything here decides what to make of the
 * answer. Running the shell is `desktop/shellEnv.ts`.
 */

/** Printed before the environment, so whatever a profile echoes first can be skipped. */
export const ENV_MARKER = '__AGENT_MASTER_3000_ENV__';

/** The shell command that prints the marker and then `env -0`. */
export function shellEnvCommand(): string {
  return `printf '%s' '${ENV_MARKER}'; command env -0`;
}

/**
 * Read `env -0` output that follows the marker. Null when the marker never
 * came, which means the shell failed before it got that far.
 */
export function parseShellEnv(stdout: string): Record<string, string> | null {
  const at = stdout.lastIndexOf(ENV_MARKER);
  if (at < 0) return null;
  const env: Record<string, string> = {};
  for (const entry of stdout.slice(at + ENV_MARKER.length).split('\0')) {
    const eq = entry.indexOf('=');
    // A name is never empty; an entry without `=` is a profile's stray output.
    if (eq <= 0) continue;
    env[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return env;
}

/**
 * Where a Mac keeps command-line tools a GUI app's PATH leaves out: Homebrew
 * on Apple Silicon and on Intel. Appended, so the shell's own order wins.
 */
const COMMON_BIN_DIRS = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin'];

export function withCommonBinDirs(pathValue: string | undefined): string {
  const dirs = (pathValue || '').split(':').filter(Boolean);
  for (const dir of COMMON_BIN_DIRS) if (!dirs.includes(dir)) dirs.push(dir);
  return dirs.join(':');
}

/**
 * What the shell's environment must not decide. The desktop app picks its own
 * address — zsh's `HOST` is the machine's name, and binding to it would put
 * the board on the network — and Electron's own switches would turn the
 * board's children (a VS Code it opens is an Electron app too) into
 * something else.
 */
const NOT_FROM_SHELL = /^(HOST|PORT|ELECTRON_.*|NODE_OPTIONS)$/;

export interface BoardEnvInput {
  /** The app's own environment, as launchd gave it. */
  inherited: Record<string, string | undefined>;
  /** The login shell's, or null when it could not be read. */
  shell: Record<string, string> | null;
  port: number;
}

/** The environment the board server process is started with. */
export function boardEnv({ inherited, shell, port }: BoardEnvInput): Record<string, string> {
  const env: Record<string, string> = {};
  for (const source of [inherited, shell ?? {}]) {
    for (const [name, value] of Object.entries(source)) {
      if (value === undefined || NOT_FROM_SHELL.test(name)) continue;
      env[name] = value;
    }
  }
  env.PATH = withCommonBinDirs(env.PATH);
  env.HOST = '127.0.0.1';
  env.PORT = String(port);
  return env;
}
