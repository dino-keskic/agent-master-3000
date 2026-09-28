import { Bot, Check, Unlink, User } from 'lucide-react';
import { CommentIndexEntry } from '../../../shared/review/commentIndex';

/**
 * One note in the index: who left it, where it is anchored, and enough of it to
 * recognise. Matches Agent Master 3000.dc.html (lines 1173-1178).
 */
export function CommentIndexRow({
  entry,
  onJump
}: {
  entry: CommentIndexEntry;
  onJump: (commentId: string) => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-3 transition-colors border-0 bg-transparent cursor-pointer"
      onClick={() => onJump(entry.id)}
    >
      {entry.resolved ? (
        <Check className="w-3.5 h-3.5 text-ok shrink-0" />
      ) : entry.author === 'agent' ? (
        <Bot className="w-3.5 h-3.5 text-run-fg shrink-0" />
      ) : (
        <User className="w-3.5 h-3.5 text-acc-fg shrink-0" />
      )}
      {entry.workspace && (
        <span
          className="font-mono text-[10px] text-ink-3 shrink-0 rounded bg-surface-3 px-1.5 py-0.5 max-w-[130px] truncate"
          title={entry.workspace}
        >
          {entry.workspace}
        </span>
      )}
      <span className="font-mono text-[11px] text-ink-2 shrink-0 w-[230px] truncate" title={entry.location}>
        {entry.location}
      </span>
      <span className="text-xs text-ink-3 flex-1 min-w-0 truncate">{entry.preview}</span>
      {entry.orphaned && (
        <Unlink className="w-3.5 h-3.5 text-wait-fg shrink-0" aria-label="Not on the current diff" />
      )}
      {entry.replyCount > 0 && (
        <span className="font-mono text-[10px] text-ink-4 shrink-0">
          {entry.replyCount} {entry.replyCount === 1 ? 'reply' : 'replies'}
        </span>
      )}
    </button>
  );
}
