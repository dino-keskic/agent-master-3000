import React from 'react';

/**
 * Clickable setting row with a title, optional description, and pure pill
 * switch toggle. Uses a single `<button role="switch">` rather than wrapping a
 * Mantine `<Switch>` inside `<label>` (which creates invalid nested labels and
 * broken click targets).
 */

export interface ToggleRowProps {
  label: React.ReactNode;
  description?: React.ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  badge?: React.ReactNode;
  className?: string;
}

export const ToggleRow: React.FC<ToggleRowProps> = ({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  badge,
  className = ''
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => {
      if (!disabled) onChange(!checked);
    }}
    className={`w-full text-left flex items-start justify-between gap-3 px-3.5 py-2.5 rounded-xl border transition-colors select-none focus:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
      disabled
        ? 'opacity-50 cursor-not-allowed border-line bg-surface/40'
        : checked
          ? 'cursor-pointer border-acc-bd/70 bg-acc-bg/45 hover:bg-acc-bg/65'
          : 'cursor-pointer border-line bg-surface hover:bg-s3h hover:border-line-strong'
    } ${className}`}
  >
    <span className="flex flex-col gap-0.5 min-w-0 flex-1">
      <span className="flex items-center gap-2">
        <span className="text-[12.5px] font-medium text-ink leading-snug">{label}</span>
        {badge}
      </span>
      {description && (
        <span className="text-[11.5px] text-ink-3 leading-relaxed">{description}</span>
      )}
    </span>
    <span
      aria-hidden
      className={`relative inline-flex shrink-0 mt-0.5 w-8 h-[18px] rounded-full transition-colors border ${
        checked ? 'bg-accent border-accent' : 'bg-surface-2 border-line-strong'
      }`}
    >
      <span
        className={`inline-block w-3.5 h-3.5 rounded-full bg-white shadow-sm transform transition-transform mt-[1px] ${
          checked ? 'translate-x-[15px]' : 'translate-x-[1px]'
        }`}
      />
    </span>
  </button>
);
