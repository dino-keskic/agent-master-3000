import React from 'react';
import { ChangelogComment } from '../../../shared/types';
import { commentRowId } from '../../../shared/review/changelogComments';
import { Markdown } from '../stream/Markdown';
import { Byline } from './Byline';
import { CommentReplyBox } from './CommentReplyBox';
import { CommentThreadHeader } from './CommentThreadHeader';
import { useCommentThread } from './useCommentThread';
import { Surface } from '../ui/Surface';

interface ChangelogCommentThreadProps {
  comment: ChangelogComment;
  /** Set where the thread is not already sitting under the line it is about. */
  showAnchor?: boolean;
  /** The note the index just jumped to; it flashes so it can be spotted. */
  focusedId?: string | null;
  onReply: (commentId: string, body: string) => void | Promise<void>;
  onResolve: (commentId: string, resolved: boolean) => void | Promise<void>;
  onDelete: (commentId: string) => void | Promise<void>;
}

/**
 * One review note and its replies.
 * Uses the design system Surface primitive to avoid baby-blue wash in light mode.
 * Matches Agent Master 3000.dc.html (lines 1199-1217).
 */
export const ChangelogCommentThread: React.FC<ChangelogCommentThreadProps> = ({
  comment,
  showAnchor = false,
  focusedId,
  onReply,
  onResolve,
  onDelete
}) => {
  const resolved = !!comment.resolvedAt;
  const focused = focusedId === comment.id;
  const thread = useCommentThread(comment, focused, onReply, onDelete);

  return (
    <Surface
      id={commentRowId(comment.id)}
      level="s1"
      border={resolved ? 'default' : 'accent'}
      radius="md"
      className={`w-full max-w-[640px] my-1.5 overflow-hidden shadow-card transition-shadow ${
        focused ? 'ring-2 ring-accent' : ''
      }`}
    >
      <CommentThreadHeader
        comment={comment}
        thread={thread}
        resolved={resolved}
        showAnchor={showAnchor}
        onResolve={onResolve}
      />

      {!thread.collapsed && (
        <div className="flex flex-col">
          {showAnchor && comment.snippet.trim() && (
            <div className="p-2.5 pb-0">
              <pre className="m-0 overflow-x-auto rounded-lg bg-code border border-hairline px-2.5 py-2 font-mono text-[11.5px] leading-relaxed text-ink-2">
                {comment.snippet}
              </pre>
            </div>
          )}

          <div className="p-2.5 text-[13px] leading-relaxed text-ink text-pretty break-words">
            <Markdown>{comment.body}</Markdown>
          </div>

          {comment.replies.length > 0 && (
            <div className="flex flex-col">
              {comment.replies.map((item) => (
                <div
                  key={item.id}
                  className="p-2.5 border-t border-hairline bg-surface-2 flex flex-col gap-1.5"
                >
                  <Byline author={item.author} at={item.createdAt} />
                  <div className="text-[13px] leading-relaxed text-ink-2 text-pretty break-words">
                    <Markdown>{item.body}</Markdown>
                  </div>
                </div>
              ))}
            </div>
          )}

          <CommentReplyBox thread={thread} />
        </div>
      )}
    </Surface>
  );
};
