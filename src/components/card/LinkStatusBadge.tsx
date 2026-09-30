import React from 'react';
import { LinkBadge, LinkBadgeTone } from '../../../shared/trackers/linkStatus';

/**
 * Where a linked ticket, PR or CI run stands, as a dot and the tracker's words.
 * What it says is decided by `linkStatusBadge`; this only paints it. Shared
 * by the card's chips and the drawer's link list so the two read alike.
 */

const TONE: Record<LinkBadgeTone, { text: string; dot: string }> = {
  done: { text: 'text-ok', dot: 'bg-ok' },
  active: { text: 'text-acc-fg', dot: 'bg-accent' },
  todo: { text: 'text-ink-3', dot: 'bg-ink-4' },
  closed: { text: 'text-ink-4 line-through', dot: 'bg-ink-4' },
  failed: { text: 'text-err-fg', dot: 'bg-err' }
};

export const LinkStatusBadge: React.FC<{ badge: LinkBadge; className?: string }> = ({ badge, className = '' }) => {
  const tone = TONE[badge.tone];
  return (
    <span className={`inline-flex items-center gap-1 shrink-0 whitespace-nowrap font-sans font-medium ${tone.text} ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tone.dot}`} />
      {badge.text}
    </span>
  );
};
