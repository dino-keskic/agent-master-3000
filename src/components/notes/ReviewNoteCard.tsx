import React, { useState } from 'react';
import { Check, CornerDownLeft, RotateCcw, Trash2 } from 'lucide-react';
import { BoardCommentItem } from '../../../shared/review/boardComments';
import { BoardTask } from '../../../shared/types';
import { relativeTime } from '../../../shared/format';
import { api } from '../../api';
import { Button, Chip, Surface } from '../ui';

interface ReviewNoteCardProps {
  item: BoardCommentItem;
  task?: BoardTask;
  onSelectTask: (task: BoardTask, jumpCommentId?: string) => void;
  onApplyTask: (task: BoardTask) => void;
}

/**
 * A single review note thread card across the board.
 */
export const ReviewNoteCard: React.FC<ReviewNoteCardProps> = ({
  item,
  task,
  onSelectTask,
  onApplyTask
}) => {
  const [replyText, setReplyText] = useState('');
  const [isReplying, setIsReplying] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
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
    try {
      setBusy(true);
      const updated = await api.deleteChangelogComment(item.taskId, comment.id);
      onApplyTask(updated);
    } catch (err) {
      console.error('Failed to delete comment', err);
    } finally {
      setBusy(false);
      setConfirmDelete(false);
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
    if (task) onSelectTask(task, comment.id);
  };

  return (
    <Surface level="s2" variant="card" border="default" radius="lg" className="overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2 bg-surface border-b border-hairline">
        <Chip
          as="button"
          tone="accent"
          className="font-mono font-semibold cursor-pointer"
          onClick={handleNavigate}
        >
          {item.taskId}
        </Chip>
        <button
          type="button"
          onClick={handleNavigate}
          className="text-[13px] font-medium text-ink truncate hover:text-acc-fg transition-colors text-left border-0 bg-transparent p-0 cursor-pointer flex-1 min-w-0"
        >
          {item.taskTitle}
        </button>
        <span className="font-mono text-[11.5px] text-ink-3 shrink-0">{item.location}</span>
      </div>

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
              <Chip tone={comment.author === 'agent' ? 'run' : 'accent'} className="uppercase">
                {comment.author === 'agent' ? 'Agent' : 'You'}
              </Chip>
              <span className="font-mono text-[11px] text-ink-4">
                {relativeTime(comment.createdAt)}
              </span>
              {isResolved && (
                <Chip tone="run" className="ml-auto">
                  <Check className="w-3 h-3" />
                  Resolved
                </Chip>
              )}
            </div>
            <div className="text-[13px] leading-relaxed text-ink whitespace-pre-wrap">{comment.body}</div>
          </div>
        </div>

        {comment.replies.length > 0 && (
          <div className="pl-4 border-l border-line ml-1 flex flex-col gap-2 pt-1">
            {comment.replies.map((reply) => (
              <div key={reply.id} className="text-xs">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-mono text-[10px] uppercase font-semibold text-ink-3">
                    {reply.author === 'agent' ? 'Agent' : 'You'}
                  </span>
                  <span className="font-mono text-[10px] text-ink-4">
                    {relativeTime(reply.createdAt)}
                  </span>
                </div>
                <div className="text-ink-2 whitespace-pre-wrap text-[12.5px]">{reply.body}</div>
              </div>
            ))}
          </div>
        )}

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
                className="flex-1 h-7 px-2.5 rounded-lg border border-line bg-surface text-xs text-ink placeholder:text-ink-4 focus:outline-none focus:border-acc-bd"
              />
              <Button
                size="sm"
                variant="primary"
                loading={busy}
                disabled={!replyText.trim()}
                leftSection={<CornerDownLeft className="w-3 h-3" />}
                onClick={() => void handleSendReply()}
              >
                Send
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setIsReplying(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsReplying(true)}
              className="flex-1 h-7 px-2.5 rounded-lg border border-line bg-surface text-xs text-ink-4 hover:text-ink-2 hover:border-line-strong flex items-center cursor-pointer text-left transition-colors"
            >
              Reply…
            </button>
          )}

          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            leftSection={isResolved ? <RotateCcw className="w-3 h-3" /> : <Check className="w-3 h-3" />}
            onClick={() => void handleToggleResolve()}
          >
            {isResolved ? 'Reopen' : 'Resolve'}
          </Button>

          {confirmDelete ? (
            <div className="flex items-center gap-1 shrink-0">
              <Button size="sm" variant="danger" loading={busy} onClick={() => void handleDelete()}>
                Delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              size="icon"
              variant="danger"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
              title="Delete comment"
              aria-label="Delete comment"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>
    </Surface>
  );
};
