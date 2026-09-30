/**
 * Whether a task's linked pull requests, tickets and CI runs are finished.
 *
 * The fetch lives in the server (`gh`, `acli`). This file only decides what a
 * status means and which links are worth asking about again, so a card can
 * gray itself out without knowing how either tracker spells "done".
 */

import { liveTasks } from '../task/archive.js';
import { classifyLink, defaultLinkTitle, MAX_LINK_TITLE, normalizeLinkUrl } from '../task/links.js';
import { BoardTask, LinkStatus, TaskLink } from '../types.js';
import { parseRunUrl } from './mentions.js';

export interface NormalizedStatus {
  state: LinkStatus['state'];
  label: string;
  stage?: LinkStatus['stage'];
}

/** `gh pr view` — MERGED / CLOSED / OPEN, plus a draft that is still open. */
export function normalizePrStatus(state: string | undefined, isDraft?: boolean): NormalizedStatus | null {
  const value = state?.trim().toUpperCase();
  if (value === 'MERGED') return { state: 'merged', label: 'Merged' };
  if (value === 'CLOSED') return { state: 'closed', label: 'Closed' };
  if (value === 'OPEN') return isDraft ? { state: 'draft', label: 'Draft' } : { state: 'open', label: 'Open' };
  return null;
}

/** Names that mean "not started" when there is no category to go by. */
const TODO_NAMES = /^(to ?do|open|new|backlog|selected for development|ready|ready for development)$/i;

/**
 * A Jira status is done when its category is Done. The name is only a fallback
 * for a payload that forgot the category — "In Review" must not count.
 *
 * An open ticket also carries its stage: category To Do (`new`) has not been
 * started, anything else in flight (`indeterminate`) is being worked on.
 */
export function normalizeJiraStatus(name: string | undefined, category?: string): NormalizedStatus | null {
  const label = name?.trim();
  if (!label && !category?.trim()) return null;
  const cat = category?.trim().toLowerCase();
  if (cat === 'done' || (!cat && /^(done|resolved|closed|complete|completed)$/i.test(label || ''))) {
    return { state: 'done', label: label || 'Done' };
  }
  if (!label) return null;
  const todo = cat ? cat === 'new' || cat === 'to do' : TODO_NAMES.test(label);
  return { state: 'open', label, stage: todo ? 'todo' : 'active' };
}

export interface LinkSettlement {
  prCount: number;
  mergedCount: number;
  /** Every linked PR is merged. False when the task has no PR. */
  prsMerged: boolean;
  ticketCount: number;
  doneCount: number;
  /** Every linked ticket is done. False when the task has no ticket. */
  ticketsDone: boolean;
  /**
   * The outside work is finished. A task with only PRs settles when they are
   * all merged; only tickets, when they are all done; both, only when each
   * group is. A link with no status yet keeps the task unsettled.
   */
  settled: boolean;
}

export function linkSettlement(links: TaskLink[] | undefined): LinkSettlement {
  const prs = (links || []).filter((link) => link.kind === 'pr');
  const tickets = (links || []).filter((link) => link.kind === 'jira');
  const mergedCount = prs.filter((link) => link.status?.state === 'merged').length;
  const doneCount = tickets.filter((link) => link.status?.state === 'done').length;
  const prsMerged = prs.length > 0 && mergedCount === prs.length;
  const ticketsDone = tickets.length > 0 && doneCount === tickets.length;
  const settled = (prs.length > 0 || tickets.length > 0) && (prs.length === 0 || prsMerged) && (tickets.length === 0 || ticketsDone);
  return { prCount: prs.length, mergedCount, prsMerged, ticketCount: tickets.length, doneCount, ticketsDone, settled };
}

/** The word a settled card prints, so the fade has a reason. */
export function settlementLabel(settlement: LinkSettlement): string | undefined {
  if (!settlement.settled) return undefined;
  if (settlement.prsMerged && settlement.ticketsDone) return 'Merged · done';
  if (settlement.prsMerged) return 'Merged';
  return 'Done';
}

export type LinkBadgeTone = 'done' | 'active' | 'todo' | 'closed' | 'failed';

export interface LinkBadge {
  text: string;
  tone: LinkBadgeTone;
}

/**
 * The status printed beside a link, and how loud it is.
 *
 * A ticket always shows the tracker's own words — "In Review" is the thing
 * you glance at a card to learn. A PR shows only what is unusual about it:
 * open is the ordinary case and prints nothing. A ticket stored before its
 * stage was recorded is placed by its name. A CI run always shows its
 * outcome — "in progress" and "success" are both news about a run.
 */
export function linkStatusBadge(link: TaskLink): LinkBadge | undefined {
  const status = link.status;
  if (!status) return undefined;
  if (link.kind === 'run') {
    const tone: LinkBadgeTone =
      status.state === 'done' ? 'done'
        : status.state === 'failed' ? 'failed'
          : status.state === 'closed' ? 'closed'
            : status.stage === 'todo' ? 'todo' : 'active';
    return { text: status.label, tone };
  }
  if (link.kind === 'jira') {
    if (status.state === 'done') return { text: status.label, tone: 'done' };
    const stage = status.stage ?? (TODO_NAMES.test(status.label) ? 'todo' : 'active');
    return { text: status.label, tone: stage };
  }
  switch (status.state) {
    case 'merged':
      return { text: 'merged', tone: 'done' };
    case 'done':
      return { text: 'done', tone: 'done' };
    case 'closed':
      return { text: 'closed', tone: 'closed' };
    case 'draft':
      return { text: 'draft', tone: 'todo' };
    case 'failed':
      return { text: 'failed', tone: 'failed' };
    default:
      return undefined;
  }
}

export type StatusTarget =
  | { kind: 'pr'; url: string; repo: string; number: number; checkedAt: number }
  | { kind: 'jira'; url: string; key: string; checkedAt: number }
  | { kind: 'run'; url: string; repo: string; runId: number; checkedAt: number };

/** A finished run can still be re-run, which is why it is asked again at all. */
const QUIET_STATES = new Set<LinkStatus['state']>(['merged', 'done', 'closed', 'failed']);

/**
 * PRs, tickets and runs whose status is missing or older than its window. Finished
 * states are asked about rarely — they almost never move backwards — and a
 * pass is capped so a board of forty links does not spawn forty CLIs at once.
 */
export function linksToRefresh(
  tasks: BoardTask[],
  now: number,
  opts: { openTtlMs: number; quietTtlMs: number; limit: number }
): StatusTarget[] {
  const byUrl = new Map<string, StatusTarget>();
  for (const task of liveTasks(tasks)) {
    for (const link of task.links || []) {
      const target = statusTarget(link);
      if (!target) continue;
      const age = now - (link.status?.checkedAt ?? 0);
      const ttl = link.status && QUIET_STATES.has(link.status.state) ? opts.quietTtlMs : opts.openTtlMs;
      if (link.status && age < ttl) continue;
      const prev = byUrl.get(target.url);
      if (!prev || target.checkedAt < prev.checkedAt) byUrl.set(target.url, target);
    }
  }
  return [...byUrl.values()]
    .sort((a, b) => a.checkedAt - b.checkedAt || (a.kind === 'pr' ? 0 : 1) - (b.kind === 'pr' ? 0 : 1))
    .slice(0, opts.limit);
}

function statusTarget(link: TaskLink): StatusTarget | null {
  const found = classifyLink(link.url);
  const checkedAt = link.status?.checkedAt ?? 0;
  const url = normalizeLinkUrl(link.url) || link.url;
  if (found.kind === 'pr' && found.ref) {
    const match = /^(.+)#(\d+)$/.exec(found.ref);
    if (!match) return null;
    return { kind: 'pr', url, repo: match[1]!, number: Number(match[2]), checkedAt };
  }
  if (found.kind === 'jira' && found.ref) return { kind: 'jira', url, key: found.ref, checkedAt };
  if (found.kind === 'run') {
    const run = parseRunUrl(url);
    if (run) return { kind: 'run', url, repo: run.repo, runId: run.runId, checkedAt };
  }
  return null;
}

export interface LinkStatusPatch {
  url: string;
  status: LinkStatus;
  /** Real title from the tracker, applied only when the link still wears its ref. */
  title?: string;
}

/**
 * Writes a refresh onto the task. `visible` is false when only the timestamp
 * moved, so the board can remember that it asked without repainting every card.
 *
 * Leaves `task.updatedAt` alone: this runs every minute a browser is open, and
 * asking GitHub or Jira how a link is doing is not something that happened to
 * the task. Stamping it put every linked task in "Updated today".
 */
export function applyLinkStatuses(task: BoardTask, patches: LinkStatusPatch[]): { visible: boolean; touched: boolean } {
  let visible = false;
  let touched = false;
  for (const patch of patches) {
    const want = normalizeLinkUrl(patch.url) || patch.url;
    for (const link of task.links || []) {
      const have = normalizeLinkUrl(link.url) || link.url;
      if (have !== want) continue;
      const before = `${link.status?.state}|${link.status?.label}|${link.title}`;
      link.status = patch.status;
      const learned = patch.title?.replace(/\s+/g, ' ').trim().slice(0, MAX_LINK_TITLE);
      if (learned && link.title === defaultLinkTitle(link.url, link.ref)) link.title = learned;
      const after = `${link.status.state}|${link.status.label}|${link.title}`;
      if (before !== after) visible = true;
      touched = true;
    }
  }
  return { visible, touched };
}
