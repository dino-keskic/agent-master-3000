/**
 * What a board card says about a task.
 *
 * The card is the densest view in the app — an id, a status, a title, two
 * tracker chips, a preview line and five pieces of metadata in a strip that has
 * to survive a narrow column. So the decisions about *which* of those to show,
 * and in what order, are made here rather than inline in the JSX.
 */

import { BoardColumn, BoardTask } from '../types.js';
import { collectActiveTools, executeCommand, isExecuteTool } from '../agent/backgroundTasks.js';
import { busySessionCount, taskSessionViews } from './sessions.js';
import { formatContext, formatUsd } from '../sessions/cost.js';
import { relativeTime, runButtonLabel } from '../format.js';
import { summarizeToolCall } from '../agent/toolCallView.js';
import { extractTodoPlan } from '../agent/todoPlan.js';

/**
 * Short display name for a model, agent or thinking level: the last segment
 * of a `provider/name` id, upper-cased. Used by the header pills, which have
 * room for `GROK-4.7` but not for `github-copilot/grok-4.7`.
 */
export function formatBadgeName(name: string): string {
  const base = name.split('/').pop() || name;
  return base.toUpperCase();
}

export interface TaskCardTool {
  /** What the agent is doing — a description if it sent one, else the gist. */
  title: string;
  /** The shell string, when this is an execute call. */
  command?: string;
  startedAt: number;
  /** Step badge from todowrite plan if present e.g. "3/7" */
  stepBadge?: string;
  /** Progress percentage (0 - 100) from todowrite plan */
  progressPercent?: number;
}

export interface TaskCardSummary {
  running: boolean;
  waiting: boolean;
  hasError: boolean;
  /** The worktree this task ran in is no longer on disk. */
  folderGone: boolean;
  /** Prompts typed during a turn that have not been sent yet. */
  queuedCount: number;
  /** The one state worth a word next to the id, or undefined when idle. */
  statusLabel?: string;
  /**
   * Which project the task belongs to — still named when its checkout is gone
   * (`folderGone` says that separately), so the card never loses it. Kept out of `meta` so the card can hold it back from
   * truncation: across a board of five repos it is the fact you scan for.
   */
  place?: string;
  /** The metadata strip, already ordered and with the blanks dropped. */
  meta: string[];
  /** The part of `meta` that is money, so the strip can pick it out. */
  cost?: string;
  /** What the whole-card link announces to a screen reader. */
  openLabel: string;
  /** The verb on the run button for the column this card sits in. */
  runLabel: string;
  /** The in-flight tool the running card shows, if any. */
  currentTool?: TaskCardTool;
  /** First queued prompt, for the "Next" line under a live tool. */
  nextPrompt?: string;
  /** What a blocked card is waiting on, spelled out. */
  waitingDetail?: string;
  /** Open review comments on this task. */
  openCommentsCount: number;
}

export function taskCardSummary(task: BoardTask, column?: BoardColumn): TaskCardSummary {
  const running = task.runState === 'running';
  const waiting = task.runState === 'awaiting_input';
  const hasError = task.runState === 'error' || !!task.error;
  const folderGone = task.cwdExists === false;
  const queuedCount = task.queued?.length ?? 0;
  const openCommentsCount = (task.changelogComments || []).filter((c) => !c.resolvedAt).length;

  // One line, so the states are ranked: something blocked on you outranks
  // something still working, which outranks something that already failed.
  const busySessions = busySessionCount(task);
  const statusLabel = waiting
    ? task.pendingRequest?.type === 'question'
      ? 'Needs an answer'
      : 'Needs approval'
    : running
      ? busySessions > 1
        ? `${busySessions} running`
        : 'Running'
      : hasError
        ? 'Error'
        : undefined;

  const cost = formatUsd(task.cost);
  const sessionCount = taskSessionViews(task).length;
  const meta = [
    cost,
    formatContext(task.contextTokens, task.contextLimit),
    relativeTime(task.updatedAt),
    sessionCount > 1 ? `${sessionCount} sessions` : undefined
  ].filter((part): part is string => !!part);
  // The project, not the worktree: a worktree's generated folder name is long
  // and says little a card needs, and the drawer shows it in full.
  const place = task.projectName || (folderGone ? 'folder gone' : undefined);

  return {
    running,
    waiting,
    hasError,
    folderGone,
    queuedCount,
    statusLabel,
    place,
    meta,
    cost,
    openLabel: `${task.id}: ${task.title}${statusLabel ? ` · ${statusLabel}` : ''}${
      queuedCount > 0 ? ` · ${queuedCount} queued` : ''
    }`,
    runLabel: runButtonLabel(column, task),
    currentTool: running ? currentToolOf(task) : undefined,
    nextPrompt: running ? nextPromptOf(task) : undefined,
    waitingDetail: waiting ? waitingDetailOf(task) : undefined,
    openCommentsCount
  };
}

function currentToolOf(task: BoardTask): TaskCardTool | undefined {
  const tools = collectActiveTools(task);
  const plan = task.logs ? extractTodoPlan(task.logs) : undefined;
  if (tools.length === 0 && !plan?.activeItem) return undefined;

  const picked = tools.length > 0
    ? tools.find((tool) => isExecuteTool(tool.toolCall)) || tools[tools.length - 1]!
    : undefined;
  const info = picked?.toolCall;
  const command = info ? executeCommand(info) : undefined;
  const description =
    typeof info?.rawInput?.description === 'string' ? info.rawInput.description.trim() : '';
  const gist = info ? summarizeToolCall(info) : '';

  const stepBadge = plan ? `${plan.activeStepNumber}/${plan.totalCount}` : undefined;
  const progressPercent = plan?.progressPercent;

  const result: TaskCardTool = {
    title: plan?.activeItem?.label || description || (command ? info?.name : gist) || info?.name || 'Executing plan',
    command,
    startedAt: picked ? picked.startedAt : Date.now()
  };
  if (stepBadge) result.stepBadge = stepBadge;
  if (progressPercent != null) result.progressPercent = progressPercent;
  return result;
}

function nextPromptOf(task: BoardTask): string | undefined {
  const prompt = task.queued?.find((turn) => turn.prompt?.trim())?.prompt?.trim();
  return prompt || undefined;
}

function waitingDetailOf(task: BoardTask): string | undefined {
  const request = task.pendingRequest;
  if (!request) return undefined;
  if (request.type === 'question') return request.message.trim() || undefined;
  const command = executeCommand(request.toolCall);
  if (command) return `Wants to run: ${command}`;
  const summary = summarizeToolCall(request.toolCall);
  if (summary) return `Wants to run: ${summary}`;
  return `Wants to run ${request.toolCall.name}`;
}

/** What colour, if any, the card's status line carries. */
export type CardStatusTone = 'wait' | 'run' | 'err' | 'done' | 'quiet';

export interface CardStatusLine {
  tone: CardStatusTone;
  text: string;
}

/** What a card may know beyond the task itself. */
export interface CardStatusContext {
  /** "+50 −13 · 4 files", once the board's change read has landed. */
  changeText?: string;
  /** "Merged", when every linked PR and ticket is finished. */
  settledLabel?: string;
}

/**
 * The card's one status line — the single most useful thing to know about the
 * task right now. Ranked: what it is asking you, what it is doing, what broke,
 * then what it left behind. Only the first three are coloured, so a board at
 * rest is quiet and the card that needs you is the one that stands out.
 */
export function cardStatusLine(
  task: Pick<BoardTask, 'error' | 'sessionId'>,
  summary: TaskCardSummary,
  context: CardStatusContext = {}
): CardStatusLine {
  if (summary.waiting) return { tone: 'wait', text: summary.waitingDetail || summary.statusLabel || 'Waiting for you' };
  if (summary.running) {
    const doing = summary.currentTool?.title || 'Working';
    const step = summary.currentTool?.stepBadge;
    return { tone: 'run', text: step ? `${doing} · ${step}` : doing };
  }
  if (summary.hasError) {
    const first = task.error?.trim().split('\n')[0]?.trim();
    return { tone: 'err', text: first || 'The last turn failed' };
  }
  if (summary.folderGone) return { tone: 'err', text: 'Folder is gone' };
  if (context.settledLabel) return { tone: 'done', text: context.settledLabel };
  if (context.changeText) return { tone: 'quiet', text: context.changeText };
  if (summary.queuedCount > 0) return { tone: 'quiet', text: `${summary.queuedCount} queued` };
  return { tone: 'quiet', text: task.sessionId ? 'Idle' : 'Not started' };
}

/**
 * The model and agent, only when they are not what the board would have used
 * anyway. On a board where every task runs the same model, a model chip on
 * every card is twenty copies of one fact.
 */
export function cardRunBadges(
  task: Pick<BoardTask, 'model' | 'agent'>,
  defaults: { model?: string; agent?: string }
): string[] {
  const badges: string[] = [];
  if (task.model && defaults.model && task.model !== defaults.model) badges.push(formatBadgeName(task.model).toLowerCase());
  if (task.agent && defaults.agent && task.agent !== defaults.agent) badges.push(task.agent);
  return badges;
}
