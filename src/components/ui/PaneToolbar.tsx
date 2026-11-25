import React from 'react';

/**
 * Consistent sub-header toolbar used at the top of drawer tabs and side
 * panels (Diff, Tools, Agents, Review Notes, Notifications, Archive).
 */

export interface PaneToolbarProps {
  left?: React.ReactNode;
  right?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export const PaneToolbar: React.FC<PaneToolbarProps> = ({
  left,
  right,
  children,
  className = ''
}) => (
  <div
    className={`flex items-center justify-between gap-2.5 px-3.5 py-2 border-b border-line bg-surface/50 shrink-0 flex-wrap ${className}`}
  >
    {children ?? (
      <>
        <div className="flex items-center gap-2 min-w-0 flex-wrap">{left}</div>
        {right && <div className="flex items-center gap-2 shrink-0 ml-auto">{right}</div>}
      </>
    )}
  </div>
);
