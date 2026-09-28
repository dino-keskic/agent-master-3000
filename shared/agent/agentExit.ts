/**
 * What to say when the agent process dies: OpenCode prints why it quit
 * (a config file it cannot parse, a database it cannot open) to stderr and
 * exits 1. Passing stderr through to the server's terminal was not enough —
 * the board said "exited (code 1)" on the task card, and the reason was
 * nowhere a user was looking. So the transport keeps the last of it, and this
 * turns that into the message a failed request, turn or model list carries.
 */

/** How much of the agent's stderr is kept: its last words, not its life story. */
export const STDERR_KEEP_CHARS = 8_000;
const MESSAGE_LINES = 12;
const MESSAGE_CHARS = 1_500;

// Colour and cursor escapes: OpenCode prints `Error:` in bold red.
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/** `buffer` with `chunk` appended, trimmed to the last `STDERR_KEEP_CHARS`. */
export function appendStderr(buffer: string, chunk: string): string {
  const next = buffer + chunk;
  return next.length > STDERR_KEEP_CHARS ? next.slice(-STDERR_KEEP_CHARS) : next;
}

/** The last few meaningful lines of stderr, plain text, one per line. */
export function stderrTail(stderr: string): string {
  const lines = stderr
    .replace(ANSI, '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim());
  const tail = lines.slice(-MESSAGE_LINES).join('\n');
  return tail.length > MESSAGE_CHARS ? `…${tail.slice(-MESSAGE_CHARS)}` : tail;
}

export interface AgentExit {
  code: number | null;
  signal?: NodeJS.Signals | null;
  /** Whether this process had answered `initialize`: dying before that is a startup failure. */
  started: boolean;
  stderr: string;
}

/** The message every request pending on a dead agent is failed with. */
export function agentExitMessage({ code, signal, started, stderr }: AgentExit): string {
  const how = code !== null ? `code ${code}` : `signal ${signal ?? 'unknown'}`;
  const said = stderrTail(stderr);
  if (!started) {
    return said
      ? `OpenCode quit while starting (${how}):\n${said}`
      : `OpenCode quit while starting (${how}) without saying why. Run \`opencode acp\` in a terminal in the project folder to see its error.`;
  }
  const base = `opencode acp process exited (${how}) before the request completed`;
  return said ? `${base}:\n${said}` : base;
}
