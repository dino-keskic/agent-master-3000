import React from 'react';
import { Check, ChevronDown, ChevronRight, RotateCcw, Trash2 } from 'lucide-react';
import { ChangelogComment } from '../../../shared/types';
import { commentLocation } from '../../../shared/review/changelogComments';
import { commentPreview } from '../../../shared/review/commentIndex';
import { Byline } from './Byline';
import { CommentThread } from './useCommentThread';

interface CommentThreadHeaderProps {
  comment: ChangelogComment;
  thread: CommentThread;
  resolved: boolean;
  showAnchor: boolean;
  onResolve: (commentId: string, resolved: boolean) => void | Promise<void>;
}

export const CommentThreadHeader: React.FC<CommentThreadHeaderProps> = ({
  comment,
  thread,
  resolved,
  showAnchor,
  onResolve
}) => (
  <div
    className={`flex items-center justify-between gap-2 px-2.5 py-1.5 bg-surface select-none ${
      resolved ? 'border-b border-hairline' : 'border-b border-acc-bd'
    }`}
  >
    <div className="flex items-center gap-2 min-w-0 flex-1">
      <Byline author={comment.author} at={comment.createdAt} />
      {resolved && (
        <span className="font-mono text-[10px] uppercase font-semibold text-run-fg shrink-0">
          resolved
        </span>
      )}
      {showAnchor && (
        <span className="font-mono text-[11px] text-ink-3 truncate min-w-0" title={commentLocation(comment)}>
          {commentLocation(comment)}
        </span>
      )}
      {thread.collapsed && (
        <span className="text-xs text-ink-2 truncate min-w-0">
          {commentPreview(comment.body)}
        </span>
      )}
    </div>

    <div className="flex items-center gap-2 shrink-0">
      <button
        type="button"
        onClick={() => thread.setCollapsed(!thread.collapsed)}
        className="flex items-center gap-1 text-[11px] text-ink-3 hover:text-ink cursor-pointer border-0 bg-transparent p-0 transition-colors"
      >
        {thread.collapsed ? (
          <>
            <ChevronRight className="w-3 h-3" />
            Show
          </>
        ) : (
          resolved && (
            <>
              <ChevronDown className="w-3 h-3" />
              Hide
            </>
          )
        )}
      </button>

      {!thread.replying && !resolved && (
        <button
          type="button"
          onClick={() => thread.setReplying(true)}
          className="text-[11px] text-ink-3 hover:text-ink cursor-pointer border-0 bg-transparent p-0 transition-colors"
        >
          Reply
        </button>
      )}

      <button
        type="button"
        onClick={() => void onResolve(comment.id, !resolved)}
        disabled={thread.busy}
        className={`flex items-center gap-1 text-[11px] cursor-pointer border-0 bg-transparent p-0 transition-colors disabled:opacity-50 ${
          resolved ? 'text-ink-3 hover:text-ink' : 'text-run-fg hover:opacity-80'
        }`}
      >
        {resolved ? (
          <>
            <RotateCcw className="w-3 h-3" />
            Reopen
          </>
        ) : (
          <>
            <Check className="w-3 h-3" />
            Resolve
          </>
        )}
      </button>

      <button
        type="button"
        onClick={thread.remove}
        disabled={thread.busy}
        title={thread.confirmDelete ? 'Click again to delete' : 'Delete note'}
        className={`flex items-center text-[11px] cursor-pointer border-0 bg-transparent p-0 transition-colors disabled:opacity-50 ${
          thread.confirmDelete ? 'text-err-fg font-semibold' : 'text-ink-4 hover:text-err-fg'
        }`}
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  </div>
);
