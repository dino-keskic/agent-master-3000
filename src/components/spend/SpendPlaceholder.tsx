import React from 'react';

/**
 * What the spend screen shows when it has no numbers.
 *
 * Three different nothings, and they must not look like each other: the first
 * read in flight, an OpenCode database that is not there, and a window that is
 * genuinely empty. Sized like the real layout so the panel does not jump when
 * the figures land.
 */

const Block: React.FC<{ className?: string }> = ({ className }) => (
  <div className={`animate-pulse rounded-xl border border-line bg-surface-2 ${className || ''}`} />
);

/** The shape of the screen, greyed, while the first read walks the message table. */
export const SpendSkeleton: React.FC = () => (
  <div className="flex flex-col gap-3.5" aria-busy="true" aria-label="Reading spend from OpenCode">
    <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
      <Block className="h-[92px]" />
      <Block className="h-[92px]" />
      <Block className="h-[92px]" />
      <Block className="h-[92px]" />
    </div>
    <Block className="h-[172px]" />
    <div className="grid gap-3.5 lg:grid-cols-3">
      <Block className="h-[200px]" />
      <Block className="h-[200px]" />
      <Block className="h-[200px]" />
    </div>
  </div>
);

/** A stated reason, not an empty screen — the usual one is "no OpenCode here". */
export const SpendUnavailable: React.FC<{ reason: string; hint?: string }> = ({ reason, hint }) => (
  <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-surface-2 px-4 py-6 text-center">
    <span className="text-[13px] text-ink-2">{reason}</span>
    {hint && <span className="font-mono text-[11px] text-ink-4">{hint}</span>}
  </div>
);
