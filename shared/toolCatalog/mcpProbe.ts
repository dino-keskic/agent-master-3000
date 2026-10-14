import { McpConfigEntry } from './opencodeV2.js';

/**
 * Which answers from a local MCP server's `tools/list` are the same answer.
 *
 * Asking means starting the server — often `npx`/`uvx` fetching a package
 * first, seconds each — so the board asks as few times as it can. What a
 * server exposes follows from how it is started, not from the folder it is
 * started in, so one answer serves every worktree: a board with a worktree
 * per task would otherwise start every MCP server again for each new task.
 *
 * The exception is a command that names a path relative to the folder
 * (`node ./mcp.js`, `--repository .`) — that one is a different server in
 * each folder, and is kept per folder.
 *
 * What belongs here: the key. Starting the server and the cache are
 * `server/toolCatalog/mcpProbe.ts`.
 */

/** `.`, `..`, `./x`, `../x` — or, for the executable, any path that is not absolute. */
function isFolderRelative(arg: string, isBin: boolean): boolean {
  if (arg === '.' || arg === '..' || arg.startsWith('./') || arg.startsWith('../')) return true;
  if (/^[-\w.]+=(\.\.?)(\/|$)/.test(arg)) return true;
  return isBin && arg.includes('/') && !arg.startsWith('/') && !arg.startsWith('~');
}

export function mcpProbeKey(entry: McpConfigEntry, cwd: string): string {
  const command = entry.command || [];
  const environment = Object.entries(entry.environment || {}).sort(([a], [b]) => a.localeCompare(b));
  const id = JSON.stringify([command, environment]);
  return command.some((arg, i) => isFolderRelative(arg, i === 0)) ? `${cwd}::${id}` : id;
}
