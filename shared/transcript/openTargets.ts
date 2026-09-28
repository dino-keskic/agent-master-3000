import { TaskLogItem } from '../types.js';

/**
 * Which files the board is willing to hand to an editor.
 *
 * The board listens on localhost, so `POST /api/open` must never become "run
 * an editor on any path you like": the first rule is that a target sits inside
 * a folder the user added to the board. But agents routinely name files that
 * live nowhere near a project — a log under `/tmp`, a config in the home
 * directory, a file in a repo that is not on the board — and the transcript
 * renders those as links. A link that can only ever fail is worse than no link,
 * so a path the agent actually named in this task's transcript is openable too.
 *
 * That keeps the bound meaningful: the transcript is written by the agent and
 * the user, not by whatever page happened to POST to the port.
 *
 * Pure and testable — the disk and the process live in `server/app/openExternal.ts`.
 */

/** What may follow a path and still be part of it. */
const PATH_TAIL = /[A-Za-z0-9_.\-/]/;

function decodeSafe(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return decoded === value ? null : decoded;
  } catch {
    // A stray `%` means the text was never percent-encoded; the raw read stands.
    return null;
  }
}

/**
 * Whether `text` names exactly this path — not merely a longer one starting
 * with it. Without the boundary check every transcript mentioning
 * `/Users/me/project/a.ts` would also authorise opening `/Users`, and opening
 * a directory in an editor is a much bigger thing than opening a file.
 */
export function pathNamedIn(text: string | undefined, absolutePath: string): boolean {
  if (!text || !absolutePath) return false;

  for (const haystack of [text, decodeSafe(text)]) {
    if (!haystack) continue;
    let at = haystack.indexOf(absolutePath);
    while (at !== -1) {
      const next = haystack[at + absolutePath.length];
      // End of the text, or a `:42`, a quote, a bracket — the path stopped here.
      if (next === undefined || !PATH_TAIL.test(next)) return true;
      at = haystack.indexOf(absolutePath, at + 1);
    }
  }
  return false;
}

/**
 * Whether a transcript names this path anywhere: in prose, in the locations a
 * tool reported touching, or in what a tool was given and what it printed.
 */
export function transcriptNamesPath(logs: TaskLogItem[] | undefined, absolutePath: string): boolean {
  if (!absolutePath.startsWith('/')) return false;

  for (const log of logs || []) {
    if (pathNamedIn(log.text, absolutePath) || pathNamedIn(log.title, absolutePath)) return true;

    const call = log.toolCall;
    if (!call) continue;
    if (call.locations?.some((location) => pathNamedIn(location, absolutePath))) return true;
    if (pathNamedIn(call.output, absolutePath)) return true;
    if (call.rawInput && pathNamedIn(JSON.stringify(call.rawInput), absolutePath)) return true;
  }
  return false;
}
