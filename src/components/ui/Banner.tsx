import React from 'react';

/**
 * Theme-aware status banner for warnings, errors, restarts, and contextual
 * notices. Uses semantic CSS variables so both dark and light schemes stay
 * legible.
 */

export type BannerTone = 'neutral' | 'accent' | 'run' | 'wait' | 'err';

const TONE_CLASSES: Record<BannerTone, string> = {
  neutral: 'bg-surface-2 border-line text-ink-2',
  accent: 'bg-acc-bg border-acc-bd text-acc-fg',
  run: 'bg-run-bg border-run-bd text-run-fg',
  wait: 'bg-wait-bg border-wait-bd text-wait-fg',
  err: 'bg-err-bg border-err-bd text-err-fg'
};

export interface BannerProps {
  tone?: BannerTone;
  icon?: React.ReactNode;
  title?: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  /** Strip mode uses bottom border only (for full-bleed drawer sub-headers). */
  strip?: boolean;
  className?: string;
}

export const Banner: React.FC<BannerProps> = ({
  tone = 'neutral',
  icon,
  title,
  children,
  actions,
  strip = false,
  className = ''
}) => (
  <div
    className={`flex items-center justify-between gap-3 px-3.5 py-2 text-[12px] leading-relaxed ${
      strip ? 'border-b shrink-0' : 'rounded-xl border'
    } ${TONE_CLASSES[tone]} ${className}`}
  >
    <div className="flex items-start gap-2 min-w-0 flex-1">
      {icon && <span className="shrink-0 mt-0.5 flex items-center">{icon}</span>}
      <div className="min-w-0 flex-1 text-ink">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={title ? 'text-ink-2 mt-0.5' : ''}>{children}</div>}
      </div>
    </div>
    {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
  </div>
);
