import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

/**
 * The "Show N more" / "Show less" line under a folded sidebar list. Renders
 * nothing when the list has nothing to fold; `hiddenCount` is what folding
 * would hide, so pass it whether or not the list is expanded.
 */
export const ShowMoreToggle: React.FC<{
  hiddenCount: number;
  expanded: boolean;
  onToggle: () => void;
  className?: string;
}> = ({ hiddenCount, expanded, onToggle, className = '' }) => {
  if (hiddenCount === 0) return null;
  const Icon = expanded ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={(e) => {
        // Inside a session card, whose own click switches the session.
        e.stopPropagation();
        onToggle();
      }}
      className={`self-start flex items-center gap-1 rounded px-1 py-0.5 type-meta text-ink-3 hover:text-ink-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent ${className}`}
    >
      <Icon className="w-3 h-3" />
      {expanded ? 'Show less' : `Show ${hiddenCount} more`}
    </button>
  );
};
