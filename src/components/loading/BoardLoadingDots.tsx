import React from 'react';

/**
 * The one moving thing on the loading screen.
 *
 * Three dots on the accent, pulsing out of phase, rather than a spinner: it
 * says "waiting" without implying a percentage the board cannot know. Reduced
 * motion drops the animation entirely and leaves the dots as a static row —
 * the message above them is what actually carries the state.
 */

const DELAYS_MS = [0, 180, 360];

export const BoardLoadingDots: React.FC = () => (
  <div className="flex items-center gap-1.5" aria-hidden="true">
    {DELAYS_MS.map((delay) => (
      <span
        key={delay}
        className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse motion-reduce:animate-none motion-reduce:opacity-40"
        style={{ animationDelay: `${delay}ms`, animationDuration: '1.2s' }}
      />
    ))}
  </div>
);
