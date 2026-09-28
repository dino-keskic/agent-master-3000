import React from 'react';

/**
 * The quiet mono chip on a card — model, agent, a session's kind, a project.
 * The paint is `.chip` in `src/index.css`. `tone` is only for a state that
 * already has a color on the board (a running session, an accent selection),
 * not a new color per kind of thing.
 */

export type ChipTone = 'neutral' | 'accent' | 'run';

const TONE: Record<ChipTone, string> = {
  neutral: 'chip',
  accent: 'chip is-accent',
  run: 'chip is-run'
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
