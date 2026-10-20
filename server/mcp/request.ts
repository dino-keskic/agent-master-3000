/**
 * How a board tool reaches the board: an HTTP call to the board the agent is
 * running under, with its token, and the shape a tool's answer goes back in.
 * Shared by the task tools (`handler.ts`) and the manager's (`managerTools.ts`).
 */

export interface BoardMcpContext {
  boardUrl: string;
  taskId: string;
  /** The board's `BOARD_TOKEN`, when it has one. */
  token?: string;
  fetchFn?: typeof fetch;
}

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

export function toolResult(text: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text }], isError };
}

export async function boardRequest(
  ctx: BoardMcpContext,
  method: string,
  pathname: string,
  body?: unknown
): Promise<unknown> {
  const fetchFn = ctx.fetchFn || fetch;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (ctx.token) headers.Authorization = `Bearer ${ctx.token}`;
  const res = await fetchFn(`${ctx.boardUrl.replace(/\/+$/, '')}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { error: text };
    }
  }
  if (!res.ok) {
    const message =
      json && typeof json === 'object' && 'error' in json && typeof json.error === 'string'
        ? json.error
        : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return json;
}
