import { MentionItem, parseRunUrl } from '../../shared/trackers/mentions.js';
import { NormalizedStatus } from '../../shared/trackers/linkStatus.js';
import {
  GhRun,
  RUN_FIELDS,
  RUN_FIELDS_WITH_JOBS,
  failedJobIds,
  formatRunJobs,
  formatRunSummary,
  normalizeRunStatus,
  runOutcome,
  runTitle,
  tidyFailedLog
} from '../../shared/trackers/runs.js';
import { runJson, runText } from './cli.js';
import { errorMessage } from '../../shared/errors.js';

/**
 * GitHub Actions runs through `gh run view`: the status a run link shows, and
 * the summary, job list and failed logs a pasted run can bring into a prompt.
 * What any of it says is decided in `shared/trackers/runs.ts`.
 */

/** Long enough for `gh` to fetch and stitch a few jobs' logs together. */
const LOG_TIMEOUT_MS = 45_000;
const LOG_BUFFER = 64_000_000;
/** A matrix of red jobs gets the first few logs; the summary names the rest. */
const MAX_LOG_JOBS = 4;

function runRef(item: MentionItem): { repo: string; runId: number; jobId?: number } {
  const ref = parseRunUrl(item.url);
  if (!ref) throw new Error(`Not an Actions run URL: ${item.url}`);
  return ref;
}

async function viewRun(repo: string, runId: number, fields: string): Promise<GhRun> {
  const raw = await runJson('gh', ['run', 'view', String(runId), `--repo=${repo}`, '--json', fields]);
  // Every field of `GhRun` is optional, so whatever `gh` printed is read defensively.
  return raw || {};
}

/** Where a linked run stands, for the card. Null when `gh` knows no such run. */
export async function workflowRunStatus(
  repo: string,
  runId: number
): Promise<{ title?: string; status: NormalizedStatus } | null> {
  const run = await viewRun(repo, runId, RUN_FIELDS);
  const status = normalizeRunStatus(run.status, run.conclusion);
  return status ? { title: runTitle(run), status } : null;
}

/** The one line behind a pasted run link. */
export async function resolveRun(item: MentionItem): Promise<MentionItem> {
  const ref = runRef(item);
  const run = await viewRun(ref.repo, ref.runId, RUN_FIELDS);
  const title = runTitle(run);
  if (!title) throw new Error(`No run ${ref.repo} ${ref.runId}`);
  return { ...item, title, status: runOutcome(run), subtitle: ref.repo };
}

export async function runSummary(item: MentionItem): Promise<string> {
  const ref = runRef(item);
  return formatRunSummary(await viewRun(ref.repo, ref.runId, RUN_FIELDS_WITH_JOBS), ref.jobId);
}

export async function runJobs(item: MentionItem): Promise<string> {
  const ref = runRef(item);
  return formatRunJobs(await viewRun(ref.repo, ref.runId, RUN_FIELDS_WITH_JOBS), ref.jobId);
}

/**
 * The failed steps' output, one red job at a time. `--log-failed` on a whole
 * run can be every matrix leg at once; asking per job keeps each one's tail —
 * where the error is — instead of letting the first job eat the budget.
 */
export async function runFailedLogs(item: MentionItem): Promise<string> {
  const ref = runRef(item);
  const run = await viewRun(ref.repo, ref.runId, RUN_FIELDS_WITH_JOBS);
  const jobs = failedJobIds(run, ref.jobId);
  if (jobs.length === 0) {
    const outcome = runOutcome(run);
    return outcome === 'in_progress' || outcome === 'queued'
      ? `The run is still ${outcome.replace(/_/g, ' ')} — no job has failed yet.`
      : 'No job in this run failed.';
  }
  const picked = jobs.slice(0, MAX_LOG_JOBS);
  const budget = Math.floor(10_000 / picked.length);
  const parts = await Promise.all(
    picked.map(async (jobId) => {
      try {
        const raw = await runText(
          'gh',
          ['run', 'view', `--job=${jobId}`, `--repo=${ref.repo}`, '--log-failed'],
          { timeoutMs: LOG_TIMEOUT_MS, maxBuffer: LOG_BUFFER }
        );
        return tidyFailedLog(raw, budget) || `(job ${jobId} printed nothing for its failed steps)`;
      } catch (e) {
        return `(could not read the log for job ${jobId}: ${errorMessage(e) ?? 'unknown error'})`;
      }
    })
  );
  const skipped = jobs.length - picked.length;
  if (skipped > 0) parts.push(`${skipped} more failed job${skipped === 1 ? '' : 's'} not shown.`);
  return parts.join('\n\n');
}
