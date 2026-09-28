/**
 * The `agent-master-3000` command line: what the flags mean, and the help text.
 *
 * Parsing only — no process, no env. `server/cli.ts` turns the result into the
 * environment the server already reads (`PORT`, `HOST`, `AGENT_MASTER_DATA_DIR`,
 * `AGENT_MASTER_CONFIG`),
 * so a flag and its variable can never mean two different things.
 */

export interface CliOptions {
  port?: number;
  host?: string;
  dataDir?: string;
  config?: string;
  /** Print where everything is, and whether it is there, then exit. */
  paths: boolean;
  help: boolean;
  version: boolean;
}

export type CliParse = { ok: true; options: CliOptions } | { ok: false; error: string };

/** Flags that take a value, by every spelling they accept. */
const VALUE_FLAGS: Record<string, 'port' | 'host' | 'dataDir' | 'config'> = {
  '--port': 'port',
  '-p': 'port',
  '--host': 'host',
  '--data-dir': 'dataDir',
  '--config': 'config'
};

function parsePort(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const port = Number(raw);
  return port >= 1 && port <= 65535 ? port : null;
}

/** `argv` without the node binary and script, i.e. `process.argv.slice(2)`. */
export function parseCliArgs(argv: readonly string[]): CliParse {
  const options: CliOptions = { paths: false, help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--version' || arg === '-v') {
      options.version = true;
      continue;
    }
    if (arg === '--paths') {
      options.paths = true;
      continue;
    }

    // `--port=4000` and `--port 4000` alike.
    const eq = arg.indexOf('=');
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    const key = VALUE_FLAGS[flag];
    if (!key) return { ok: false, error: `unknown option '${arg}'` };
    const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
    if (value === undefined || value === '') return { ok: false, error: `option '${flag}' needs a value` };

    if (key === 'port') {
      const port = parsePort(value);
      if (port === null) return { ok: false, error: `invalid port '${value}' (1-65535)` };
      options.port = port;
    } else {
      options[key] = value;
    }
  }
  return { ok: true, options };
}

export function cliHelp(version: string, defaultPort: number): string {
  return `agent-master-3000 ${version} — a Kanban board for OpenCode sessions

Usage: agent-master-3000 [options]

Options:
  -p, --port <port>     Port to listen on (default ${defaultPort}, env PORT)
      --host <host>     Address to bind (default 127.0.0.1, env HOST)
      --data-dir <dir>  Where the board keeps its state and attachments
                        (default $XDG_DATA_HOME/agent-master-3000 or
                        ~/.local/share/agent-master-3000, env AGENT_MASTER_DATA_DIR)
      --config <file>   The setup file the settings panel writes: the data
                        folder and where OpenCode is (default
                        ~/.config/agent-master-3000/config.json, env AGENT_MASTER_CONFIG)
      --paths           Show where the board and OpenCode are, and exit
  -h, --help            Show this help
  -v, --version         Show the version

Environment (see the README for the full list):
  BOARD_STATE_FILE      The board's state file, instead of <data-dir>/board_state.json
  OPENCODE_BIN          OpenCode executable (default: found on PATH or in the
                        usual install folders)
  OPENCODE_CONFIG_DIR   An extra OpenCode config folder
  OPENCODE_DB           OpenCode database to read sessions from
  OPENCODE_MODELS_PATH  OpenCode's model list (models.json)
  ACP_COMMAND           Command spawned for an ACP session (default: opencode acp)

A variable wins over the setup file. Needs OpenCode, signed in to a provider;
the board's settings (the gear in the header) show what it found.`;
}
