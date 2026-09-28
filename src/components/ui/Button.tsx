import React, { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'run' | 'wait' | 'danger';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'icon' | 'icon-sm';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftSection?: React.ReactNode;
  rightSection?: React.ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:brightness-105 shadow-sm border-0',
  secondary: 'border border-line bg-surface-2 text-ink-2 hover:border-line-strong hover:text-ink',
  ghost: 'bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink border-0',
  run: 'bg-run-bg text-run-fg hover:bg-run-bd/20 border border-run-bd',
  wait: 'bg-wait text-wait-ink font-semibold hover:brightness-105 border-0',
  danger: 'border border-line text-ink-3 hover:border-err-bd hover:text-err-fg bg-transparent'
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: 'h-6 px-2 text-[11px] gap-1.5 rounded-md font-medium',
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md font-medium',
  md: 'h-8 px-3 text-sm gap-2 rounded-lg font-medium',
  icon: 'w-7 h-7 p-0 justify-center rounded-md',
  'icon-sm': 'w-6 h-6 p-0 justify-center rounded-md'
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'sm',
    loading = false,
    disabled = false,
    leftSection,
    rightSection,
    className = '',
    children,
    type = 'button',
    ...rest
  },
  ref
) {
  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      className={`inline-flex items-center select-none cursor-pointer transition-colors duration-150 disabled:opacity-45 disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      {loading ? (
        <Loader2 className="w-3 h-3 animate-spin shrink-0" />
      ) : (
        leftSection && <span className="shrink-0 flex items-center">{leftSection}</span>
      )}
      {children && <span className="truncate">{children}</span>}
      {!loading && rightSection && <span className="shrink-0 flex items-center">{rightSection}</span>}
    </button>
  );
});
