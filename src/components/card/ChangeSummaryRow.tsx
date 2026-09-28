import React from 'react';
import { FileDiff } from 'lucide-react';
import { Chip, Type } from '../ui';
import {
  CHANGE_FLAG_LABEL,
  TaskChangeSummary,
  changeDetailLabel,
  changeScopeLabel,
  formatChangeDigest,
  summarizeChanges
} from '../../../shared/git/changeSummary';

interface ChangeSummaryRowProps {
  summary: TaskChangeSummary;
}

/**
 * The computed change line on a card: `+128 −34 · 6 files`, plus a chip per
 * flag the paths raised. A clean tree shows nothing — advertising "no changes"
 * on every idle card is how a board turns into a wall of grey.
 */
export const ChangeSummaryRow: React.FC<ChangeSummaryRowProps> = ({ summary }) => {
  const digest = summarizeChanges(summary);
  if (digest.files === 0) return null;

  const detail = changeDetailLabel(digest);
  const partial = summary.workspaces.some((workspace) => workspace.truncated);
  const title = [changeScopeLabel(summary), formatChangeDigest(digest), detail, partial ? 'partial read' : undefined]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex flex-wrap items-center gap-1.5" title={title}>
      <Type role="meta" tone="muted" className="inline-flex items-center gap-1">
        <FileDiff className="w-3 h-3 text-ink-4 shrink-0" />
        {formatChangeDigest(digest)}
      </Type>
      {digest.flags.map((flag) => (
        <Chip key={flag}>{CHANGE_FLAG_LABEL[flag]}</Chip>
      ))}
    </div>
  );
};
