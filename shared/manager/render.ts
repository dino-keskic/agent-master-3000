/**
 * The manager's tool results as text.
 *
 * The model reads these, not a person, so they are plain and regular: one
 * block per task, the same labels every time, ages relative to `now` so it
 * can tell what changed since it last looked without doing date arithmetic.
 */

import { formatUsd } from '../sessions/cost.js';
import { ATTENTION_ORDER, Attention, BoardDigest, TaskDetail, TaskDigest } from './digest.js';

const HEADINGS: Record<Attention, string> = {
  'needs-you': 'Blocked on the user',
  failed: 'Failed',
  running: 'Running',
  resting: 'Idle (turn finished or not started)'
};

export function formatAge(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function renderTask(task: TaskDigest, now: number): string {
  const facts = [
    `column ${task.column}`,
    task.project ? `project ${task.project}` : undefined,
    `updated ${formatAge(task.updatedAt, now)}`,
    task.queued ? `${task.queued} queued` : undefined,
    task.changedFiles ? `${task.changedFiles} files changed` : undefined,
    task.cost ? formatUsd(task.cost) : undefined
  ].filter(Boolean);
  const lines = [`- ${task.id} "${task.title}" (${facts.join(', ')})`];
  if (task.blockedOn) lines.push(`  blocked on: ${task.blockedOn}`);
  if (task.options?.length) lines.push(`  options: ${task.options.join(' | ')}`);
  if (task.error) lines.push(`  error: ${task.error}`);
  if (task.lastUser) lines.push(`  last asked: ${task.lastUser}`);
  if (task.lastAgent) lines.push(`  last reply: ${task.lastAgent}`);
  if (task.links.length) lines.push(`  links: ${task.links.join('; ')}`);
  return lines.join('\n');
}

export function renderBoardDigest(digest: BoardDigest): string {
  if (digest.tasks.length === 0) return 'The board has no tasks.';
  const { counts } = digest;
  const sections = [
    `${digest.tasks.length} tasks: ${counts['needs-you']} blocked on the user, ${counts.failed} failed, `
      + `${counts.running} running, ${counts.resting} idle.`
  ];
  for (const attention of ATTENTION_ORDER) {
    const tasks = digest.tasks.filter((task) => task.attention === attention);
    if (tasks.length === 0) continue;
    sections.push(`## ${HEADINGS[attention]}\n${tasks.map((task) => renderTask(task, digest.generatedAt)).join('\n')}`);
  }
  return sections.join('\n\n');
}

export function renderTaskDetail(detail: TaskDetail, now: number): string {
  const sections = [renderTask(detail.digest, now), `## Original request\n${detail.prompt || '(none)'}`];
  if (detail.recent.length > 0) {
    const turns = detail.recent.map((turn) => `[${turn.who}, ${formatAge(turn.at, now)}] ${turn.text}`);
    sections.push(`## Recent conversation, oldest first\n${turns.join('\n\n')}`);
  } else {
    sections.push('## Recent conversation\nNothing yet.');
  }
  return sections.join('\n\n');
}
