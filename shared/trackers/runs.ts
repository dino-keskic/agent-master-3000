/**
 * GitHub Actions runs, as a prompt and a card read them.
 *
 * `server/trackers/actions.ts` asks `gh run view` and hands the JSON here.
 * Everything that decides what the answer says lives in this file: which jobs
 * are worth naming, which steps failed, how much of a failed log survives the
 * trip into a prompt.
 */

import { NormalizedStatus } from './linkStatus.js';

export interface GhRunStep {
  name?: string;
  number?: number;
  status?: string;
  conclusion?: string | null;
}

export interface GhRunJob {
  databaseId?: number;
  name?: string;
  status?: string;
  conclusion?: string | null;
  startedAt?: string;
  completedAt?: string;
  url?: string;
  steps?: GhRunStep[];
}

export interface GhRun {
  databaseId?: number;
  name?: string;
  workflowName?: string;
  displayTitle?: string;
  status?: string;
  conclusion?: string | null;
  event?: string;
  headBranch?: string;
  headSha?: string;
  attempt?: number;
  url?: string;
  createdAt?: string;
  updatedAt?: string;
  jobs?: GhRunJob[];
}

/** The `--json` fields every read of a run asks for. */
export const RUN_FIELDS = 'databaseId,name,workflowName,displayTitle,status,conclusion,event,headBranch,headSha,attempt,url,createdAt,updatedAt';
export const RUN_FIELDS_WITH_JOBS = `${RUN_FIELDS},jobs`;

const RED = new Set(['failure', 'timed_out', 'startup_failure', 'action_required']);
const GRAY = new Set(['cancelled', 'skipped', 'neutral', 'stale']);

/** One word for where a run or job is: its conclusion once it has one, its status until then. */
export function runOutcome(run: { status?: string; conclusion?: string | null }): string {
  const conclusion = run.conclusion?.trim().toLowerCase();
  if (conclusion) return conclusion;
  return run.status?.trim().toLowerCase() || 'unknown';
}

/**
 * What a run means for the link badge. A run still going is `open` and
 * active; a finished one is done, failed, or closed for the ones that were
 * called off rather than lost.
 */
export function normalizeRunStatus(status: string | undefined, conclusion?: string | null): NormalizedStatus | null {
  const state = status?.trim().toLowerCase();
  const outcome = conclusion?.trim().toLowerCase();
  if (!state && !outcome) return null;
  if (state && state !== 'completed' && !outcome) {
    return { state: 'open', label: state.replace(/_/g, ' '), stage: state === 'in_progress' ? 'active' : 'todo' };
  }
  const label = (outcome || 'completed').replace(/_/g, ' ');
  if (outcome === 'success') return { state: 'done', label };
  if (outcome && RED.has(outcome)) return { state: 'failed', label };
  if (outcome && GRAY.has(outcome)) return { state: 'closed', label };
  return { state: 'done', label };
}

/** `CI: Fix login loop` — the name a run link is worth wearing. */
export function runTitle(run: GhRun): string | undefined {
  const workflow = (run.workflowName || run.name || '').trim();
  const title = (run.displayTitle || '').trim();
  if (workflow && title && workflow !== title) return `${workflow}: ${title}`;
  return workflow || title || undefined;
}

function jobIsRed(job: GhRunJob): boolean {
  return RED.has(runOutcome(job));
}

function jobIsGreen(job: GhRunJob): boolean {
  const outcome = runOutcome(job);
  return outcome === 'success' || GRAY.has(outcome);
}

function failedSteps(job: GhRunJob): GhRunStep[] {
  return (job.steps || []).filter((step) => RED.has(runOutcome(step)));
}

function duration(from?: string, to?: string): string {
  const start = from ? Date.parse(from) : NaN;
  const end = to ? Date.parse(to) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '';
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function runHeader(run: GhRun): string[] {
  const where = [
    run.headBranch && `branch ${run.headBranch}`,
    run.headSha && `@${run.headSha.slice(0, 7)}`,
    run.event && `on ${run.event}`,
    run.attempt && run.attempt > 1 ? `attempt ${run.attempt}` : ''
  ]
    .filter(Boolean)
    .join(' ');
  return [runTitle(run) || `Run ${run.databaseId ?? ''}`.trim(), [runOutcome(run), where].filter(Boolean).join(' · ')];
}

/** Only the job a job link points at, when it points at one. */
function scopedJobs(run: GhRun, jobId?: number): GhRunJob[] {
  const jobs = run.jobs || [];
  if (!jobId) return jobs;
  const one = jobs.filter((job) => job.databaseId === jobId);
  return one.length > 0 ? one : jobs;
}

/**
 * What is fetched the moment a run is pasted: where it stands, every job that
 * is not green with the steps that failed, and a count of the rest. A run of
 * forty green matrix jobs and one red one should read as the red one.
 */
export function formatRunSummary(run: GhRun, jobId?: number): string {
  const jobs = scopedJobs(run, jobId);
  const lines = runHeader(run);
  if (jobs.length === 0) return [...lines, 'No jobs have started.'].join('\n');

  const notable = jobs.filter((job) => !jobIsGreen(job));
  const green = jobs.length - notable.length;
  lines.push('');
  for (const job of notable) {
    lines.push(`- ${runOutcome(job)}: ${job.name || 'job'}${job.url ? `\n  ${job.url}` : ''}`);
    for (const step of failedSteps(job)) lines.push(`  ✗ step ${step.number ?? '?'}: ${step.name || 'step'}`);
  }
  if (notable.length === 0) lines.push(`All ${jobs.length} jobs passed or were skipped.`);
  else if (green > 0) lines.push(`${green} other job${green === 1 ? '' : 's'} passed or were skipped.`);
  return lines.join('\n');
}

/** Every job and every step, for when the summary is not enough. */
export function formatRunJobs(run: GhRun, jobId?: number): string {
  const jobs = scopedJobs(run, jobId);
  const lines = runHeader(run);
  if (jobs.length === 0) return [...lines, 'No jobs have started.'].join('\n');
  for (const job of jobs) {
    const took = duration(job.startedAt, job.completedAt);
    lines.push('', `${job.name || 'job'} — ${runOutcome(job)}${took ? ` (${took})` : ''}`);
    for (const step of job.steps || []) {
      const mark = RED.has(runOutcome(step)) ? '✗' : runOutcome(step) === 'success' ? '✓' : '·';
      lines.push(`  ${mark} ${step.number ?? '?'}. ${step.name || 'step'} — ${runOutcome(step)}`);
    }
  }
  return lines.join('\n');
}

/** The jobs whose logs are worth asking for: the red ones in scope. */
export function failedJobIds(run: GhRun, jobId?: number): number[] {
  return scopedJobs(run, jobId)
    .filter(jobIsRed)
    .flatMap((job) => (job.databaseId ? [job.databaseId] : []));
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?/;

/** Room one failed log gets in a prompt; the mention body is capped after this. */
export const MAX_FAILED_LOG = 10_000;

/**
 * `gh run view --log-failed` prints `job<TAB>step<TAB>timestamp line`, in
 * colour. What an agent needs is the line, grouped under the step it came
 * from, and — because the error is almost always at the bottom — the end of
 * it when it will not all fit.
 */
export function tidyFailedLog(raw: string, max = MAX_FAILED_LOG): string {
  const out: string[] = [];
  let heading = '';
  for (const line of (raw || '').replace(ANSI, '').split('\n')) {
    const parts = line.split('\t');
    const text = (parts.length >= 3 ? parts.slice(2).join('\t') : line).replace(TIMESTAMP, '').replace(/\r$/, '');
    const where = parts.length >= 3 ? `${parts[0]} › ${parts[1]}` : '';
    if (where && where !== heading) {
      heading = where;
      out.push(`## ${where}`);
    }
    out.push(text);
  }
  const text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) return '';
  if (text.length <= max) return text;
  const tail = text.slice(text.length - max);
  return `…earlier lines cut…\n${tail.slice(tail.indexOf('\n') + 1)}`;
}
