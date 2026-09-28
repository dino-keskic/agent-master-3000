import React, { useRef } from 'react';
import { Surface } from '../ui/Surface';
import { Button } from '../ui/Button';
import { MicButton } from '../../speech/MicButton';
import { dictateInto } from '../../speech/dictateInto';

/** A note being written on a diff line, before it exists as a comment. */
interface CommentDraftProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitting?: boolean;
  /** The diff line being commented on, echoed above the box. */
  anchor?: string;
  snippet?: string;
}

export const CommentDraft: React.FC<CommentDraftProps> = ({
  value,
  onChange,
  onSubmit,
  onCancel,
  submitting = false,
  anchor,
  snippet
}) => {
  const box = useRef<HTMLTextAreaElement | null>(null);

  return (
    <Surface
      level="s1"
      border="accent"
      radius="md"
      className="w-full max-w-[640px] my-1.5 p-2.5 flex flex-col gap-2 shadow-card"
    >
      {anchor && (
        <span className="font-mono text-[11px] text-ink-3 truncate" title={anchor}>
          {anchor}
        </span>
      )}
      {snippet?.trim() && (
        <pre className="m-0 overflow-x-auto rounded-lg bg-code border border-hairline px-2.5 py-2 font-mono text-[11.5px] leading-relaxed text-ink-2">
          {snippet}
        </pre>
      )}
      <textarea
        ref={box}
        rows={2}
        autoFocus
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        placeholder="Leave a note on this change… ⌘Enter to save"
        className="w-full rounded-md border border-line bg-surface p-2 text-xs text-ink font-sans outline-none focus:border-accent resize-y min-h-[50px] placeholder:text-ink-4"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            if (value.trim()) onSubmit();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="flex items-center justify-end gap-2">
        <MicButton size="sm" onText={(clip) => dictateInto(box.current, box.current?.value ?? value, onChange, clip)} />
        <span className="flex-1" />
        <Button size="xs" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="xs"
          variant="primary"
          onClick={onSubmit}
          loading={submitting}
          disabled={!value.trim()}
        >
          Comment
        </Button>
      </div>
    </Surface>
  );
};
