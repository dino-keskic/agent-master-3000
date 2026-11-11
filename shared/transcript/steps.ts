import { TaskLogItem } from '../types.js';
import { isSubagentTool, toolKind, ToolKind } from '../agent/toolCall.js';

/**
 * Folding the work between two messages into one line.
 *
 * A transcript is read as a conversation: what you asked, what the agent said.
 * The reads, greps and edits in between are how it got there, and a turn that
 * makes forty of them used to bury its own answer. A run of them becomes one
 * block — "12 steps · read 6 files, edited 2, ran 3 commands" — that opens to
 * the calls themselves.
 */

export type TranscriptBlock =
  | { kind: 'entry'; log: TaskLogItem; index: number }
  | {
      kind: 'steps';
      /** The first log's id: stable while the run grows at its end. */
      id: string;
      logs: TaskLogItem[];
      /** Index of the first log in the list that was folded. */
      index: number;
      summary: string;
      /** A call in the run has not finished. */
      live: boolean;
      failed: number;
    };

/** A single call is shorter than the line that would stand in for it. */
export const MIN_FOLDED_STEPS = 2;

/**
 * Work, as opposed to conversation. A subagent call is left out: it is a
 * doorway into another session, and folding it away hides the door.
 */
function isStep(log: TaskLogItem): boolean {
  if (log.type === 'thought') return true;
  if (log.type !== 'tool_call') return false;
  return !(log.toolCall && isSubagentTool(log.toolCall.name));
}

function kindOf(log: TaskLogItem): ToolKind {
  const info = log.toolCall;
  if (!info) return 'other';
  const named = toolKind(info.name);
  if (named !== 'other') return named;
  const reported = info.kind as ToolKind | undefined;
  return reported && ['read', 'edit', 'execute', 'search', 'fetch'].includes(reported) ? reported : 'other';
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "12 steps · read 6 files, edited 2, ran 3 commands". */
export function stepsSummary(logs: TaskLogItem[]): string {
  const calls = logs.filter((log) => log.type === 'tool_call');
  const tally: Record<ToolKind, number> = { read: 0, edit: 0, execute: 0, search: 0, fetch: 0, other: 0 };
  for (const call of calls) tally[kindOf(call)]++;

  const parts = [
    tally.read ? `read ${count(tally.read, 'file', 'files')}` : '',
    tally.edit ? `edited ${tally.edit}` : '',
    tally.execute ? `ran ${count(tally.execute, 'command', 'commands')}` : '',
    tally.search ? `searched ${count(tally.search, 'time', 'times')}` : '',
    tally.fetch ? `fetched ${count(tally.fetch, 'page', 'pages')}` : '',
    tally.other ? count(tally.other, 'other call', 'other calls') : ''
  ].filter(Boolean);

  const head = calls.length > 0 ? count(calls.length, 'step', 'steps') : 'Thinking';
  return parts.length > 0 ? `${head} · ${parts.join(', ')}` : head;
}

function isLive(log: TaskLogItem): boolean {
  const status = log.toolCall?.status;
  return log.type === 'tool_call' && !!log.toolCall && (!status || status === 'pending' || status === 'in_progress');
}

export function foldSteps(logs: TaskLogItem[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  let run: TaskLogItem[] = [];
  let runStart = 0;

  const flush = () => {
    if (run.length === 0) return;
    const calls = run.filter((log) => log.type === 'tool_call').length;
    if (calls >= MIN_FOLDED_STEPS) {
      blocks.push({
        kind: 'steps',
        id: run[0]!.id,
        logs: run,
        index: runStart,
        summary: stepsSummary(run),
        live: run.some(isLive),
        failed: run.filter((log) => log.toolCall?.status === 'failed').length
      });
    } else {
      run.forEach((log, offset) => blocks.push({ kind: 'entry', log, index: runStart + offset }));
    }
    run = [];
  };

  logs.forEach((log, index) => {
    if (isStep(log)) {
      if (run.length === 0) runStart = index;
      run.push(log);
      return;
    }
    flush();
    blocks.push({ kind: 'entry', log, index });
  });
  flush();
  return blocks;
}
