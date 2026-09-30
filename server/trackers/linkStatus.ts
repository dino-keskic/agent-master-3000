/**
 * Asks GitHub and Jira how the board's linked PRs, tickets and CI runs are
 * getting on.
 *
 * A pass is a handful of CLIs, not one per link: finished states are trusted
 * for a while, and anything still open is asked again every couple of minutes
 * while someone is looking at the board. Nothing here runs when the board has
 * no browser attached.
 */

import { linksToRefresh, LinkStatusPatch, StatusTarget } from '../../shared/trackers/linkStatus.js';
import { LiveHub } from '../live/hub.js';
import { pullRequestStatus } from './github.js';
import { jiraIssueStatus } from './jira.js';
import { workflowRunStatus } from './actions.js';
import { BoardPublisher } from '../live/publisher.js';
import { taskStore } from '../board/taskStore.js';

const OPEN_TTL_MS = 2 * 60 * 1000;
const QUIET_TTL_MS = 20 * 60 * 1000;
const PASS_LIMIT = 6;
const INTERVAL_MS = 60 * 1000;
const CONCURRENCY = 3;

let running = false;
let again = false;
let timer: NodeJS.Timeout | null = null;
let publisherRef: BoardPublisher | null = null;
let hubRef: LiveHub | null = null;

/** Start the loop. One immediate pass, then every minute a browser is open. */
export function startLinkStatusRefresh(hub: LiveHub, publisher: BoardPublisher): void {
  hubRef = hub;
  publisherRef = publisher;
  const tick = () => {
    if (hub.hasClients()) kickLinkStatusRefresh();
    timer = setTimeout(tick, INTERVAL_MS);
    timer.unref();
  };
  tick();
}

/** Run a pass now. A pass already in flight runs one more when it finishes. */
export function kickLinkStatusRefresh(): void {
  if (!publisherRef) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  void runPass(publisherRef)
    .catch((e) => console.warn('[Links] Status refresh failed:', e))
    .finally(() => {
      running = false;
      if (again) {
        again = false;
        kickLinkStatusRefresh();
      }
    });
}

async function runPass(publisher: BoardPublisher): Promise<void> {
  if (hubRef && !hubRef.hasClients()) return;
  const now = Date.now();
  const targets = linksToRefresh(taskStore.getTasks(), now, {
    openTtlMs: OPEN_TTL_MS,
    quietTtlMs: QUIET_TTL_MS,
    limit: PASS_LIMIT
  });
  if (targets.length === 0) return;

  const found = new Map<string, LinkStatusPatch>();
  await mapLimit(targets, CONCURRENCY, async (target) => {
    const patch = await readTarget(target, now);
    if (patch) found.set(target.url, patch);
  });
  if (found.size === 0) return;

  const byTask = new Map<string, LinkStatusPatch[]>();
  for (const task of taskStore.listLiveTasks()) {
    const patches = [...found.values()].filter((patch) =>
      (task.links || []).some((link) => link.url === patch.url)
    );
    if (patches.length > 0) byTask.set(task.id, patches);
  }
  for (const task of taskStore.applyLinkStatuses(byTask)) publisher.updated(task);
}

let warnedAt = 0;

async function readTarget(target: StatusTarget, now: number): Promise<LinkStatusPatch | null> {
  try {
    const read = target.kind === 'pr'
      ? await pullRequestStatus(target.repo, target.number)
      : target.kind === 'run'
        ? await workflowRunStatus(target.repo, target.runId)
        : await jiraIssueStatus(target.key);
    if (!read) return null;
    return { url: target.url, title: read.title, status: { ...read.status, checkedAt: now } };
  } catch (e) {
    // A missing `gh` or `acli` fails every link. One warning a while is enough.
    if (now - warnedAt > QUIET_TTL_MS) {
      warnedAt = now;
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`[Links] Could not read ${target.kind} status (${target.url}): ${message}`);
    }
    return null;
  }
}

async function mapLimit<T>(items: T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await run(items[index]!);
    }
  });
  await Promise.all(workers);
}
