import { ToolCallInfo } from '../types.js';

/**
 * What an OpenCode 2 Code Mode call ran.
 *
 * 2.x does not hand a model its MCP tools: it hands it `execute`, which runs a
 * script against a `tools` object — `tools["echo-board"].echo({ text })`. On
 * the wire that is one call named `execute`, so without this the transcript
 * shows a script and the tools panel counts nothing against the MCP tools it
 * called. The finished call says what ran, in `rawOutput.metadata.toolCalls`
 * (`{ tool: "echo-board.echo" }`, verified on 2.0.24 in the sandbox); while it
 * is still running the script is all there is, so it is read for call sites.
 *
 * What belongs here: reading those calls out of a tool call. Ingesting them is
 * `server/acp/transcript.ts` and `server/opencode/history.ts`.
 */

export const CODE_MODE_TOOL = 'execute';

/** OpenCode's own helpers (`list_mcp_resources`, …) — not tools the board can switch. */
const OWN_NAMESPACE = 'opencode';

/** `.name` or `["name"]`, the two ways a script reaches into `tools`. */
const ACCESSOR = String.raw`(?:\s*\.\s*([A-Za-z_$][\w$]*)|\s*\[\s*["'\`]([^"'\`]+)["'\`]\s*\])`;
const CALL_SITE = new RegExp(String.raw`\btools${ACCESSOR}${ACCESSOR}\s*\(`, 'g');

function fromMetadata(metadata: unknown): string[] | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const calls = (metadata as Record<string, unknown>).toolCalls;
  if (!Array.isArray(calls)) return undefined;
  return calls
    .map((call) => (call && typeof call === 'object' ? (call as Record<string, unknown>).tool : undefined))
    .filter((tool): tool is string => typeof tool === 'string' && tool.includes('.'));
}

function fromScript(code: string): string[] {
  const calls: string[] = [];
  for (const match of code.matchAll(CALL_SITE)) {
    const server = match[1] ?? match[2];
    const tool = match[3] ?? match[4];
    if (server && tool) calls.push(`${server}.${tool}`);
  }
  return calls;
}

/**
 * The `server.tool` calls a Code Mode call made, in order and once per call —
 * or undefined when this is not a Code Mode call. `metadata` is the finished
 * call's `rawOutput.metadata`; without it the script's call sites stand in.
 */
export function codeModeCalls(
  info: Pick<ToolCallInfo, 'name' | 'rawInput'>,
  metadata?: unknown
): string[] | undefined {
  if (info.name.trim() !== CODE_MODE_TOOL) return undefined;
  const reported = fromMetadata(metadata);
  if (reported) return reported;
  const code = info.rawInput?.code;
  return typeof code === 'string' ? fromScript(code) : undefined;
}

/**
 * The MCP server and tool a Code Mode call reached, split at the first dot —
 * or undefined for OpenCode's own helpers. `tools.ts` turns the pair into the
 * name the panel knows it by: `echo-board.echo` is `echo-board_echo`.
 */
export function codeModeTarget(call: string): { server: string; tool: string } | undefined {
  const dot = call.indexOf('.');
  if (dot <= 0 || dot === call.length - 1) return undefined;
  const server = call.slice(0, dot);
  return server === OWN_NAMESPACE ? undefined : { server, tool: call.slice(dot + 1) };
}

/** The one-line gist of a Code Mode call: what it called, first one first. */
export function summarizeCodeModeCalls(calls: string[]): string | null {
  const unique = [...new Set(calls)];
  if (unique.length === 0) return null;
  return unique.length > 1 ? `${unique[0]} +${unique.length - 1} more` : unique[0] ?? null;
}
