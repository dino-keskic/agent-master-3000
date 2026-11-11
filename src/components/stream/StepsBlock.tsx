import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';

/**
 * A run of tool calls, folded into one line of the conversation
 * (`foldSteps`). Closed, it says what was done; open, it is the calls
 * themselves, exactly as they were drawn before.
 */

interface StepsBlockProps {
  summary: string;
  /** A call in the run is still going: what it is, shown beside the summary. */
  live: boolean;
  liveLabel?: string;
  failed: number;
  children: React.ReactNode;
}

export const StepsBlock: React.FC<StepsBlockProps> = ({ summary, live, liveLabel, failed, children }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className={`steps-block${open ? ' is-open' : ''}`}>
      <button type="button" className="steps-block-head" aria-expanded={open} onClick={() => setOpen((prev) => !prev)}>
        <ChevronRight className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        {live && <span className="w-1.5 h-1.5 rounded-full bg-run animate-pulse shrink-0" />}
        <span className="truncate">{summary}</span>
        {live && liveLabel && <span className="truncate text-ink-2">· {liveLabel}</span>}
        {failed > 0 && <span className="shrink-0 text-err-fg">· {failed} failed</span>}
      </button>
      {open && <div className="steps-block-body">{children}</div>}
    </div>
  );
};
