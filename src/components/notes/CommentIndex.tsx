import React, { useState } from 'react';
import { ChevronDown, ChevronRight, MessageSquare } from 'lucide-react';
import { CommentIndexEntry } from '../../../shared/review/commentIndex';
import { CommentIndexRow } from './CommentIndexRow';
import { Surface } from '../ui/Surface';

interface CommentIndexProps {
  entries: CommentIndexEntry[];
  onJump: (commentId: string) => void;
}

/**
 * Every review note on one screen, at the top of the Changes tab.
 * Matches Agent Master 3000.dc.html (lines 1162-1179).
 */
export const CommentIndex: React.FC<CommentIndexProps> = ({ entries, onJump }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [showResolved, setShowResolved] = useState(false);

  if (entries.length === 0) return null;

  const open = entries.filter((entry) => !entry.resolved);
  const resolved = entries.length - open.length;
  const shown = showResolved ? entries : open;

  return (
    <Surface level="s2" border="default" radius="lg" className="mb-3 overflow-hidden shrink-0 shadow-panel">
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-hairline cursor-pointer select-none"
        role="button"
        tabIndex={0}
        onClick={() => setCollapsed((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setCollapsed((prev) => !prev);
          }
        }}
      >
        {collapsed ? (
          <ChevronRight className="w-3.5 h-3.5 text-ink-3 shrink-0" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-ink-3 shrink-0" />
        )}
        <MessageSquare className="w-3.5 h-3.5 text-acc-fg shrink-0" />
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2">
          Comments
        </span>
        <span className="font-mono text-[10px] font-semibold px-2 py-0.5 rounded-full bg-acc-bg text-acc-fg shrink-0">
          {open.length} open
        </span>
        {resolved > 0 && (
          <span className="font-mono text-[10px] font-semibold px-2 py-0.5 rounded-full bg-run-bg text-run-fg shrink-0">
            {resolved} resolved
          </span>
        )}
        <div className="flex-1" />
        {resolved > 0 && (
          <button
            type="button"
            className="font-mono text-[11px] text-ink-3 hover:text-ink shrink-0 border-0 bg-transparent cursor-pointer p-0"
            onClick={(e) => {
              e.stopPropagation();
              setShowResolved((prev) => !prev);
              setCollapsed(false);
            }}
          >
            {showResolved ? 'Hide resolved' : 'Show resolved'}
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="max-h-64 overflow-y-auto divide-y divide-hairline">
          {shown.length === 0 ? (
            <span className="font-mono text-[11px] text-ink-3 px-3 py-2 block">
              Every note on this task is resolved.
            </span>
          ) : (
            shown.map((entry) => <CommentIndexRow key={entry.id} entry={entry} onJump={onJump} />)
          )}
        </div>
      )}
    </Surface>
  );
};
