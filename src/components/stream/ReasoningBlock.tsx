import React, { useEffect, useRef, useState } from 'react';
import { Collapse, UnstyledButton, Group } from '@mantine/core';
import { Brain, ChevronRight, Loader2 } from 'lucide-react';
import { Markdown } from './Markdown';
import { Surface } from '../ui';

interface ReasoningBlockProps {
  text: string;
  /** True while thought chunks are still arriving for this block. */
  isStreaming: boolean;
  durationMs?: number;
}

/**
 * One line of the thought for the collapsed header. Markers are stripped rather
 * than rendered: the preview is a single unstyled line, and `**like this**` in
 * it reads as noise.
 */
function preview(text: string, max = 90): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`~#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * Collapsible reasoning panel. Opens itself while the model is thinking and
 * collapses once the thought completes, unless the user has taken manual
 * control of it.
 */
export const ReasoningBlock: React.FC<ReasoningBlockProps> = ({ text, isStreaming, durationMs }) => {
  const [open, setOpen] = useState(isStreaming);
  const userControlled = useRef(false);
  const wasStreaming = useRef(isStreaming);

  useEffect(() => {
    if (userControlled.current) return;
    if (isStreaming && !wasStreaming.current) {
      setOpen(true);
    } else if (!isStreaming && wasStreaming.current) {
      setOpen(false);
    }
    wasStreaming.current = isStreaming;
  }, [isStreaming]);

  const seconds = durationMs && durationMs >= 1000 ? Math.round(durationMs / 1000) : null;
  const label = isStreaming ? 'Thinking…' : seconds ? `Thought for ${seconds}s` : 'Thought process';

  // Reasoning stays neutral. It is the most common block in a long transcript,
  // and a colour of its own would tint the whole log.
  return (
    <Surface level="s1" border="default" radius="md" className="overflow-hidden">
      <UnstyledButton
        onClick={() => {
          userControlled.current = true;
          setOpen((o) => !o);
        }}
        className="w-full px-2.5 py-[7px] tool-name hover:bg-surface-2 transition-colors"
      >
        <Group gap={8} wrap="nowrap">
          <ChevronRight className={`w-3 h-3 text-ink-4 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
          {isStreaming
            ? <Loader2 className="w-3.5 h-3.5 text-ink-3 shrink-0 animate-spin" />
            : <Brain className="w-3.5 h-3.5 text-ink-3 shrink-0" />}
          <span className="tool-name font-mono font-medium text-ink-2 shrink-0 whitespace-nowrap">{label}</span>
          {!open && (
            <span className="tool-name font-mono text-ink-4 truncate min-w-0">
              {preview(text)}
            </span>
          )}
        </Group>
      </UnstyledButton>

      <Collapse in={open}>
        <div className="px-2.5 pb-2.5 pt-1.5 border-t border-hairline">
          <Markdown className="md-quiet">{text}</Markdown>
        </div>
      </Collapse>
    </Surface>
  );
};
