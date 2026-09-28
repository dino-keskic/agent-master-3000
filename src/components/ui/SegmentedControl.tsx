import React from 'react';

export interface SegmentOption<T extends string = string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  count?: number | string;
}

export interface SegmentedControlProps<T extends string = string> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentOption<T>[];
  size?: 'sm' | 'xs';
  className?: string;
}

export function SegmentedControl<T extends string = string>({
  value,
  onChange,
  options,
  size = 'sm',
  className = ''
}: SegmentedControlProps<T>) {
  const heightClass = size === 'xs' ? 'h-6 text-[11px] px-2' : 'h-6 text-xs px-2.5';

  return (
    <div
      className={`inline-flex items-center gap-0.5 p-0.5 border border-line rounded-lg bg-surface-2 ${className}`}
      role="tablist"
    >
      {options.map((opt) => {
        const isActive = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(opt.value)}
            className={`inline-flex items-center gap-1.5 ${heightClass} rounded-md font-medium cursor-pointer transition-colors border-0 select-none ${
              isActive
                ? 'bg-s4 text-ink shadow-card'
                : 'bg-transparent text-ink-3 hover:text-ink-2'
            }`}
          >
            {opt.icon && <span className="shrink-0">{opt.icon}</span>}
            <span>{opt.label}</span>
            {opt.count != null && (
              <span
                className={`font-mono text-[10px] px-1 rounded-full ${
                  isActive ? 'text-ink-3' : 'text-ink-4'
                }`}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
