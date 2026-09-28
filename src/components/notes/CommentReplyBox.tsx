import React, { useRef } from 'react';
import { MessageSquareReply } from 'lucide-react';
import { CommentThread } from './useCommentThread';
import { Button } from '../ui/Button';
import { MicButton } from '../../speech/MicButton';
import { dictateInto } from '../../speech/dictateInto';

/** Replying to a note: a link until it is clicked, then the box itself. */
export const CommentReplyBox: React.FC<{ thread: CommentThread }> = ({ thread }) => {
  const box = useRef<HTMLTextAreaElement | null>(null);

  if (!thread.replying) {
    return (
      <div className="px-2.5 py-1.5 border-t border-hairline bg-surface flex items-center">
        <button
          type="button"
          onClick={() => thread.setReplying(true)}
          className="flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink cursor-pointer border-0 bg-transparent p-0 transition-colors"
        >
          <MessageSquareReply className="w-3.5 h-3.5 text-ink-4" />
          <span>Reply…</span>
        </button>
      </div>
    );
  }

  return (
    <div className="p-2.5 border-t border-hairline bg-surface-2 flex flex-col gap-2">
      <textarea
        ref={box}
        rows={2}
        autoFocus
        value={thread.reply}
        onChange={(e) => thread.setReply(e.currentTarget.value)}
        placeholder="Reply… ⌘Enter to send"
        className="w-full rounded-md border border-line bg-surface p-2 text-xs text-ink font-sans outline-none focus:border-accent resize-y min-h-[50px] placeholder:text-ink-4"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            void thread.sendReply();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            thread.setReplying(false);
          }
        }}
      />
      <div className="flex items-center justify-end gap-2">
        <MicButton
          size="sm"
          onText={(clip) => dictateInto(box.current, box.current?.value ?? thread.reply, thread.setReply, clip)}
        />
        <span className="flex-1" />
        <Button size="xs" variant="ghost" onClick={() => thread.setReplying(false)}>
          Cancel
        </Button>
        <Button
          size="xs"
          variant="primary"
          onClick={() => void thread.sendReply()}
          loading={thread.busy}
          disabled={!thread.reply.trim()}
        >
          Reply
        </Button>
      </div>
    </div>
  );
};
