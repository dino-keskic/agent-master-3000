import React from 'react';
import { Surface } from './Surface';

/**
 * Quiet, structured empty state shared by lists, drawers, and panels when
 * nothing matches a filter or a collection has no items yet.
 */

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  compact = false,
  className = ''
}) => (
  <Surface
    level="s1"
    border="default"
    radius="lg"
    className={`flex flex-col items-center justify-center text-center ${
      compact ? 'px-4 py-6 gap-1.5' : 'px-6 py-10 gap-2.5'
    } ${className}`}
  >
    {icon && (
      <div className="w-9 h-9 rounded-xl bg-surface-2 border border-line flex items-center justify-center text-ink-3 mb-0.5">
        {icon}
      </div>
    )}
    {title && <div className="text-[13px] font-semibold text-ink">{title}</div>}
    {description && (
      <div className="text-[12px] text-ink-3 max-w-[360px] leading-relaxed">{description}</div>
    )}
    {action && <div className="mt-1.5 flex items-center gap-2">{action}</div>}
  </Surface>
);
