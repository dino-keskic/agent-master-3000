import React from 'react';
import { Bot, User } from 'lucide-react';
import { ChangelogComment } from '../../../shared/types';
import { relativeTime } from '../../../shared/format';

/** Who wrote a note or a reply, and when. Matches Agent Master 3000.dc.html. */
export const Byline: React.FC<{ author: ChangelogComment['author']; at: number }> = ({ author, at }) => {
  const isAgent = author === 'agent';
  const colorClass = isAgent ? 'text-run-fg' : 'text-acc-fg';

  return (
    <div className="flex items-center gap-1.5 font-mono text-[10px]">
      {isAgent ? (
        <Bot className={`w-3 h-3 ${colorClass} shrink-0`} />
      ) : (
        <User className={`w-3 h-3 ${colorClass} shrink-0`} />
      )}
      <span className={`font-semibold uppercase tracking-wider ${colorClass}`}>
        {isAgent ? 'Agent' : 'You'}
      </span>
      <span className="text-ink-4 tabular-nums normal-case">
        {relativeTime(at)}
      </span>
    </div>
  );
};
