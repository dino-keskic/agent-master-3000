import React, { forwardRef } from 'react';

/**
 * Surface levels mapping directly to design tokens:
 * - canvas: base background (#0b0f19 / #f4f6fa)
 * - s0: subtle background (#090d16 / #f8fafc)
 * - s1: primary container surface (#0d1322 / #ffffff)
 * - s2: secondary panel surface (#111a2c / #fbfcfe)
 * - s3: elevated card surface with blur (#1e293b wash / #ffffff)
 * - s4: inset tile surface (#16203a / #ffffff)
 * - code: monospace code surface (#020617 / #f8fafc)
 */
export type SurfaceLevel = 'canvas' | 's0' | 's1' | 's2' | 's3' | 's4' | 'code';

export type SurfaceVariant = 'default' | 'card' | 'panel' | 'running' | 'waiting' | 'error';
export type SurfaceBorder = 'default' | 'hairline' | 'accent' | 'run' | 'wait' | 'err' | 'none';
export type SurfaceRadius = 'none' | 'sm' | 'md' | 'lg' | 'xl' | 'full';

export interface SurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  level?: SurfaceLevel;
  variant?: SurfaceVariant;
  border?: SurfaceBorder;
  radius?: SurfaceRadius;
  interactive?: boolean;
}

const LEVEL_CLASSES: Record<SurfaceLevel, string> = {
  canvas: 'bg-canvas',
  s0: 'bg-surface-3',
  s1: 'bg-surface',
  s2: 'bg-surface-2',
  s3: 'bg-s3 backdrop-blur-panel',
  s4: 'bg-s4',
  code: 'bg-code'
};

const BORDER_CLASSES: Record<SurfaceBorder, string> = {
  default: 'border border-line',
  hairline: 'border border-hairline',
  accent: 'border border-acc-bd',
  run: 'border border-run-bd',
  wait: 'border border-wait-bd',
  err: 'border border-err-bd',
  none: 'border-0'
};

const RADIUS_CLASSES: Record<SurfaceRadius, string> = {
  none: 'rounded-none',
  sm: 'rounded-md',
  md: 'rounded-lg',
  lg: 'rounded-xl',
  xl: 'rounded-2xl',
  full: 'rounded-full'
};

export const Surface = forwardRef<HTMLDivElement, SurfaceProps>(function Surface(
  {
    level = 's1',
    variant = 'default',
    border = 'default',
    radius = 'md',
    interactive = false,
    className = '',
    children,
    ...rest
  },
  ref
) {
  let variantClasses = '';
  let borderClass = BORDER_CLASSES[border];

  if (variant === 'card') {
    variantClasses = 'shadow-card';
  } else if (variant === 'panel') {
    variantClasses = 'shadow-panel';
  } else if (variant === 'running') {
    variantClasses = 'bg-run-bg border-run-bd shadow-card relative before:content-[""] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-0.5 before:bg-run';
    borderClass = 'border border-run-bd';
  } else if (variant === 'waiting') {
    variantClasses = 'bg-wait-bg border-wait-bd shadow-card relative before:content-[""] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-0.5 before:bg-wait';
    borderClass = 'border border-wait-bd';
  } else if (variant === 'error') {
    variantClasses = 'bg-err-bg border-err-bd relative before:content-[""] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-0.5 before:bg-err';
    borderClass = 'border border-err-bd';
  }

  const interactiveClasses = interactive
    ? 'cursor-pointer transition-colors duration-150 hover:border-line-strong hover:bg-s3h'
    : '';

  const classes = [
    variant === 'running' || variant === 'waiting' || variant === 'error'
      ? ''
      : LEVEL_CLASSES[level],
    borderClass,
    RADIUS_CLASSES[radius],
    variantClasses,
    interactiveClasses,
    className
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={ref} className={classes} {...rest}>
      {children}
    </div>
  );
});
