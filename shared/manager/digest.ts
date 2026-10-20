/**
 * The board as the manager reads it: one short record per task, sorted into
 * what needs the user, what broke, what is running and what is resting.
 *
 * Everything here is a fact the board already holds — run state, the question
 * an agent is blocked on, the last thing it said — so the manager never has to
 * read a transcript to know where a task stands, and the model's tokens go on
 * judgement instead. The text it is shown is `render.ts`.
 */

import { findColumn } from '../board/columns.js';
import { clipText } from '../sessions/list.js';
import { liveTaskSessions } from '../task/sessions.js';
import { BoardColumn, BoardTask, PendingRequest, TaskLogItem, TaskLogType } from '../types.js';
import { isManagerTask } from './identity.js';

/** Where a task sits in the manager's triage, most urgent first. */
export type Attention = 'needs-you' | 'failed' | 'running' | 'resting';

export const ATTENTION_ORDER: Attention[] = ['needs-you', 'failed', 'running', 'resting'];

export interface TaskDigest {
  id: string;
  title: string;
  column: string;
  project?: string;
  attention: Attention;
  /** What the agent is blocked on, in a line, when it is. */
  blockedOn?: string;
  /** The choices a blocked agent offered, when it offered any. */
  options?: string[];
  error?: string;
  lastAgent?: string;
  lastUser?: string;
  queued: number;
  cost?: number;
  changedFiles?: number;
  /** Linked PRs and tickets, as "ref: state". */
  links: string[];
  updatedAt: number;
}

export interface BoardDigest {
  generatedAt: number;
  tasks: TaskDigest[];
  counts: Record<Attention, number>;
}

/** One line of a task's recent conversation. */
export interface DigestTurn {
  who: 'user' | 'agent' | 'error';
  at: number;
  text: string;
}

export interface TaskDetail {
  digest: TaskDigest;
  prompt: string;
  recent: DigestTurn[];
}

/** Long enough to carry a question or a conclusion, short enough for twenty tasks. */
const LINE_CHARS = 280;
const DETAIL_CHARS = 1200;

/** The request a task is blocked on, from whichever of its sessions holds it. */
export function pendingRequestOf(task: BoardTask): PendingRequest | undefined {
  if (task.pendingRequest) return task.pendingRequest;
  return liveTaskSessions(task).find((link) => link.pendingRequest)?.pendingRequest;
}

function describeInput(input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  for (const key of ['command', 'filePath', 'path', 'url', 'pattern', 'description']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

export function describeRequest(request: PendingRequest): { blockedOn: string; options?: string[] } {
  if (request.type === 'permission') {
    const target = describeInput(request.toolCall.rawInput);
    return {
      blockedOn: `permission to run ${request.toolCall.name}${target ? `: ${clipText(target, LINE_CHARS)}` : ''}`,
      options: request.options.map((option) => option.name)
    };
  }
  const options = request.fields.flatMap((field) => (field.options || []).map((option) => option.label));
  return {
    blockedOn: `question: ${clipText(request.message, LINE_CHARS) || '(no text)'}`,
    options: options.length > 0 ? options : undefined
  };
}

export function attentionOf(task: BoardTask): Attention {
  if (pendingRequestOf(task) || task.runState === 'awaiting_input') return 'needs-you';
  if (task.runState === 'error') return 'failed';
  if (task.runState === 'running') return 'running';
  return 'resting';
}

export function digestTask(task: BoardTask, columns: BoardColumn[]): TaskDigest {
  const request = pendingRequestOf(task);
  const described = request ? describeRequest(request) : undefined;
  return {
    id: task.id,
    title: task.title,
    column: findColumn(columns, task.columnId)?.title || task.columnId,
    project: task.projectName,
    attention: attentionOf(task),
    blockedOn: described?.blockedOn,
    options: described?.options,
    error: clipText(task.error, LINE_CHARS),
    lastAgent: clipText(task.lastMessage, LINE_CHARS),
    lastUser: clipText(task.lastUserMessage, LINE_CHARS),
    queued: task.queued?.length || 0,
    cost: task.cost,
    changedFiles: task.changeSummary?.files,
    links: (task.links || [])
      .filter((link) => link.status)
      .map((link) => `${link.ref || link.title}: ${link.status!.label}`),
    updatedAt: task.updatedAt
  };
}

/**
 * Every live task but the manager, most urgent first and, within a bucket,
 * most recently touched first.
 */
export function boardDigest(tasks: BoardTask[], columns: BoardColumn[], now: number): BoardDigest {
  const digests = tasks
    .filter((task) => !isManagerTask(task) && !task.archivedAt)
    .map((task) => digestTask(task, columns))
    .sort((a, b) => {
      const rank = ATTENTION_ORDER.indexOf(a.attention) - ATTENTION_ORDER.indexOf(b.attention);
      return rank !== 0 ? rank : b.updatedAt - a.updatedAt;
    });
  const counts = { 'needs-you': 0, failed: 0, running: 0, resting: 0 } as Record<Attention, number>;
  for (const digest of digests) counts[digest.attention] += 1;
  return { generatedAt: now, tasks: digests, counts };
}

const TURN_TYPES: Partial<Record<TaskLogType, DigestTurn['who']>> = {
  user_say: 'user',
  agent_say: 'agent',
  error: 'error'
};

/**
 * The last `limit` things said in a task's conversation — prompts, replies and
 * errors, without the tool calls and thinking between them, which are what
 * make a transcript too long to read and are not what a status is made of.
 */
export function recentTurns(logs: TaskLogItem[] | undefined, limit: number): DigestTurn[] {
  const turns: DigestTurn[] = [];
  for (let i = (logs?.length || 0) - 1; i >= 0 && turns.length < limit; i--) {
    const log = logs![i];
    if (!log) continue;
    const who = TURN_TYPES[log.type];
    const text = clipText(log.text, DETAIL_CHARS);
    if (who && text) turns.push({ who, at: log.timestamp, text });
  }
  return turns.reverse();
}

export function taskDetail(task: BoardTask, columns: BoardColumn[], limit = 8): TaskDetail {
  return {
    digest: digestTask(task, columns),
    prompt: clipText(task.originalPrompt || task.prompt, DETAIL_CHARS) || '',
    recent: recentTurns(task.logs, limit)
  };
}
