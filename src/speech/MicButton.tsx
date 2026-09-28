import React from 'react';
import { Tooltip } from '@mantine/core';
import { Loader2, Mic, Square } from 'lucide-react';
import { formatElapsed, micHint } from '../../shared/composer/dictation';
import { useDictation } from './useDictation';

/**
 * The microphone beside a prompt box. Click to talk, click again to have it
 * typed in where the caret was; Esc throws the clip away.
 *
 * The recording lives in here rather than in the box that owns the text, so
 * the meter redrawing every frame repaints this button and nothing else.
 */

interface MicButtonProps {
  /** What was said, cleaned up. Where it goes is the caller's business. */
  onText: (text: string) => void;
  disabled?: boolean;
  /** `md` matches the composer's send button; `sm` sits in a comment box's button row. */
  size?: 'md' | 'sm';
}

export const MicButton: React.FC<MicButtonProps> = ({ onText, disabled = false, size = 'md' }) => {
  const dictation = useDictation(onText);
  const { phase, level, elapsed, status } = dictation;
  const recording = phase === 'recording';
  const busy = phase === 'transcribing' || phase === 'opening';
  const box = size === 'md' ? 'w-8 h-8 rounded-lg' : 'w-6 h-6 rounded-md';
  const icon = size === 'md' ? 'w-4 h-4' : 'w-3.5 h-3.5';

  const hint =
    phase === 'transcribing'
      ? status?.state === 'downloading' || status?.state === 'starting'
        ? micHint(status, false)
        : 'Transcribing…'
      : micHint(status, recording);

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {recording && (
        <span className="font-mono text-[11px] text-err-fg tabular-nums flex items-center gap-1" aria-live="polite">
          <span className="w-1.5 h-1.5 rounded-full bg-err animate-pulse" />
          {formatElapsed(elapsed)}
        </span>
      )}
      {phase === 'transcribing' && size === 'md' && (
        <span className="font-mono text-[11px] text-ink-3">{hint}</span>
      )}
      <Tooltip label={hint} withArrow multiline maw={280} disabled={phase === 'transcribing' && size === 'md'}>
        <button
          type="button"
          onClick={dictation.toggle}
          disabled={(disabled && !recording) || busy || status?.state === 'unavailable'}
          aria-label={recording ? 'Stop dictation' : 'Dictate'}
          aria-pressed={recording}
          className={`${box} flex items-center justify-center shrink-0 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
            recording
              ? 'bg-err text-white'
              : 'bg-transparent text-ink-3 hover:text-ink hover:bg-surface border border-transparent hover:border-line'
          }`}
          // The ring grows with the voice: the only proof, before the text
          // arrives, that the right microphone is the one listening.
          style={recording ? { boxShadow: `0 0 0 ${1 + level * 6}px var(--err-bg)` } : undefined}
        >
          {busy ? (
            <Loader2 className={`${icon} animate-spin`} />
          ) : recording ? (
            <Square className={size === 'md' ? 'w-3 h-3' : 'w-2.5 h-2.5'} fill="currentColor" />
          ) : (
            <Mic className={icon} />
          )}
        </button>
      </Tooltip>
    </div>
  );
};
