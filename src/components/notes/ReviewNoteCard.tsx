import React, { useState } from 'react';
import { BoardCommentItem } from '../../../shared/review/boardComments';
import { BoardTask } from '../../../shared/types';
import { relativeTime } from '../../../shared/format';
import { api } from '../../api';
import { CornerDownLeft, Loader2, Trash2 } from 'lucide-react';

interface ReviewNoteCardProps {
  item: BoardCommentItem;
  task?: BoardTask;
  onSelectTask: (task: BoardTask, jumpCommentId?: string) => void;
  onApplyTask: (task: BoardTask) => void;
}

/**
 * A single review note thread card across the board.
 * Matches Agent Master 3000.dc.html (lines 1272-1297).
 */
export const ReviewNoteCard: React.FC<ReviewNoteCardProps> = ({
  item,
  task,
  onSelectTask,
  onApplyTask
}) => {
  const [replyText, setReplyText] = useState('');
  const [isReplying, setIsReplying] = useState(false);
  const [busy, setBusy] = useState(false);
  const comment = item.comment;
  const isResolved = !!comment.resolvedAt;

  const handleToggleResolve = async () => {
    try {
      setBusy(true);
      const updated = await api.resolveChangelogComment(item.taskId, comment.id, !isResolved);
      onApplyTask(updated);
    } catch (err) {
      console.error('Failed to resolve comment', err);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this review note?')) return;
    try {
      setBusy(true);
      const updated = await api.deleteChangelogComment(item.taskId, comment.id);
      onApplyTask(updated);
    } catch (err) {
      console.error('Failed to delete comment', err);
    } finally {
      setBusy(false);
    }
  };

  const handleSendReply = async () => {
    const text = replyText.trim();
    if (!text) return;
    try {
      setBusy(true);
      const updated = await api.replyToChangelogComment(item.taskId, comment.id, text, 'user');
      onApplyTask(updated);
      setReplyText('');
      setIsReplying(false);
    } catch (err) {
      console.error('Failed to post reply', err);
    } finally {
      setBusy(false);
    }
  };

  const handleNavigate = () => {
    if (task) {
      onSelectTask(task, comment.id);
    }
  };

  return (
    <div className="border border-line rounded-xl bg-surface-2 overflow-hidden shadow-card transition-colors">
      {/* Header bar */}
      <div className="flex items-center gap-2.5 px-3.5 py-2 bg-surface border-b border-hairline">
        <button
          type="button"
          onClick={handleNavigate}
          className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded-md bg-acc-bg text-acc-fg hover:opacity-80 transition-opacity cursor-pointer border-0"
        >
          {item.taskId}
        </button>
        <button
          type="button"
          onClick={handleNavigate}
          className="text-[13px] font-medium text-ink truncate hover:text-accent transition-colors text-left border-0 bg-transparent p-0 cursor-pointer flex-1 min-w-0"
        >
          {item.taskTitle}
        </button>
        <span className="font-mono text-[11px] text-ink-3 shrink-0">{item.location}</span>
      </div>

      {/* Content */}
      <div className="p-3.5 flex flex-col gap-2.5">
        {comment.snippet && (
          <div className="font-mono text-[11.5px] leading-relaxed text-ink-2 bg-code border border-hairline rounded-lg px-2.5 py-2 overflow-x-auto whitespace-pre">
            {comment.snippet}
          </div>
        )}

        <div className="flex gap-2.5">
          <div className={`w-[3px] rounded-full shrink-0 ${isResolved ? 'bg-ok' : 'bg-accent'}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-[10px] uppercase tracking-wider font-semibold text-acc-fg">
                {comment.author === 'agent' ? 'Agent' : 'You'}
              </span>
              <span className="font-mono text-[10px] text-ink-4">
                {relativeTime(comment.createdAt)}
              </span>
              {isResolved && (
                <span className="font-mono text-[10px] text-ok ml-auto">✓ Resolved</span>
              )}
            </div>
            <div className="text-[13px] leading-relaxed text-ink whitespace-pre-wrap">{comment.body}</div>
          </div>
        </div>

        {/* Replies */}
        {comment.replies.length > 0 && (
          <div className="pl-4 border-l border-line ml-1 flex flex-col gap-2 pt-1">
            {comment.replies.map((reply) => (
              <div key={reply.id} className="text-xs">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-mono text-[9.5px] uppercase font-semibold text-ink-3">
                    {reply.author === 'agent' ? 'Agent' : 'You'}
                  </span>
                  <span className="font-mono text-[9.5px] text-ink-4">
                    {relativeTime(reply.createdAt)}
                  </span>
                </div>
                <div className="text-ink-2 whitespace-pre-wrap text-[12.5px]">{reply.body}</div>
              </div>
            ))}
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center gap-2 pt-1">
          {isReplying ? (
            <div className="flex-1 flex items-center gap-1.5">
              <input
                type="text"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSendReply();
                  }
                  if (e.key === 'Escape') setIsReplying(false);
                }}
                autoFocus
                placeholder="Write a reply…"
                className="flex-1 h-[30px] px-2.5 rounded-md border border-line bg-surface text-xs text-ink placeholder:text-ink-4 focus:outline-none focus:border-accent"
              />
              <button
                type="button"
                disabled={busy || !replyText.trim()}
                onClick={() => void handleSendReply()}
                className="h-[30px] px-2.5 rounded-md bg-accent text-white text-xs font-medium hover:brightness-110 disabled:opacity-50 flex items-center gap-1 cursor-pointer border-0"
              >
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <CornerDownLeft className="w-3 h-3" />}
                Send
              </button>
              <button
                type="button"
                onClick={() => setIsReplying(false)}
                className="h-[30px] px-2 rounded-md border border-line bg-transparent text-xs text-ink-3 hover:text-ink cursor-pointer"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsReplying(true)}
              className="flex-1 h-[30px] px-2.5 rounded-md border border-line bg-surface-3 text-xs text-ink-4 hover:text-ink-2 flex items-center cursor-pointer text-left"
            >
              Reply…
            </button>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => void handleToggleResolve()}
            className="h-[30px] px-3 rounded-md border border-line bg-transparent text-xs text-ink-2 hover:border-line-h hover:text-ink cursor-pointer disabled:opacity-50 transition-colors"
          >
            {isResolved ? 'Reopen' : 'Resolve'}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => void handleDelete()}
            title="Delete comment"
            className="h-[30px] px-2.5 rounded-md border border-line bg-transparent text-xs text-ink-3 hover:border-err-bd hover:text-err-fg cursor-pointer disabled:opacity-50 transition-colors flex items-center justify-center"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
};
