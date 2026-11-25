import React from 'react';
import { Loader, Tooltip } from '@mantine/core';
import { Surface } from './Surface';

/**
 * Reusable metric tile for Spend and Usage summaries.
 */

export interface StatTileProps {
  label: string;
  value?: string;
  footer?: string;
  tip?: string;
  lead?: boolean;
  busy?: boolean;
  compact?: boolean;
  className?: string;
}

export const StatTile: React.FC<StatTileProps> = ({
  label,
  value,
  footer,
  tip,
  lead = false,
  busy = false,
  compact = false,
  className = ''
}) => {
  const figure = (
    <span
      className={`font-mono tabular-nums leading-tight ${
        compact
          ? 'text-[18px] font-semibold text-ink'
          : lead
            ? 'text-[28px] font-bold text-ink'
            : 'text-[22px] font-semibold text-ink-2'
      }`}
    >
      {value || '—'}
    </span>
  );

  const body = (
    <>
      <span className="font-mono text-[11px] uppercase tracking-[0.07em] text-ink-3">{label}</span>
      {busy && !value ? (
        <span className="flex h-6 items-center">
          <Loader size={12} color="gray" />
        </span>
      ) : tip ? (
        <Tooltip label={tip} withArrow position="top-start" multiline maw={240}>
          {figure}
        </Tooltip>
      ) : (
        figure
      )}
      {footer && <span className="font-mono text-[11px] text-ink-4 truncate">{footer}</span>}
    </>
  );

  if (compact) {
    return <div className={`flex min-w-0 flex-col gap-0.5 px-3 py-2.5 ${className}`}>{body}</div>;
  }

  return (
    <Surface
      level="s2"
      border={lead ? 'accent' : 'default'}
      radius="lg"
      className={`flex flex-col gap-1 p-4 ${className}`}
    >
      {body}
    </Surface>
  );
};
