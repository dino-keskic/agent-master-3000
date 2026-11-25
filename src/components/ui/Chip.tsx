import React from 'react';

/**
 * The quiet mono chip on a card — model, agent, a session's kind, a project, or
 * a status badge. The paint is `.chip` in `src/index.css`. `tone` maps to the
 * board's semantic states (`accent`, `run`, `wait`, `err`).
 */

export type ChipTone = 'neutral' | 'accent' | 'run' | 'wait' | 'err';

const TONE: Record<ChipTone, string> = {
  neutral: 'chip',
  accent: 'chip is-accent',
  run: 'chip is-run',
  wait: 'chip is-wait',
  err: 'chip is-err'
};

export const Chip = React.forwardRef<
  HTMLElement,
  { tone?: ChipTone; as?: 'span' | 'button' } & React.HTMLAttributes<HTMLElement>
>(function Chip({ tone = 'neutral', as, className = '', ...rest }, ref) {
  const Tag = as ?? 'span';
  return (
    <Tag
      ref={ref as never}
      {...(Tag === 'button' ? { type: 'button' as const } : {})}
      className={`${TONE[tone]} ${className}`}
      {...rest}
    />
  );
});
