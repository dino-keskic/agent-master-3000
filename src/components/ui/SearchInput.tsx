import React, { forwardRef } from 'react';
import { Search, X } from 'lucide-react';

/**
 * Unified theme-aware search and filter input used across toolbars, rails,
 * and modals. Includes a leading search icon, an inline clear button when
 * non-empty, and an optional right-side slot.
 */

export interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  size?: 'xs' | 'sm' | 'md';
  rightSlot?: React.ReactNode;
  containerClassName?: string;
}

const SIZE_CLASSES: Record<'xs' | 'sm' | 'md', { box: string; icon: string; input: string }> = {
  xs: {
    box: 'h-7 px-2 gap-1.5 rounded-lg',
    icon: 'w-3.5 h-3.5',
    input: 'text-[12px]'
  },
  sm: {
    box: 'h-8 px-2.5 gap-2 rounded-lg',
    icon: 'w-3.5 h-3.5',
    input: 'text-[12.5px]'
  },
  md: {
    box: 'h-9 px-3 gap-2 rounded-xl',
    icon: 'w-4 h-4',
    input: 'text-[13px]'
  }
};

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    value,
    onChange,
    size = 'xs',
    placeholder = 'Filter…',
    rightSlot,
    containerClassName = '',
    className = '',
    onKeyDown,
    ...rest
  },
  ref
) {
  const sz = SIZE_CLASSES[size];

  return (
    <div
      className={`inline-flex items-center border border-line bg-surface transition-colors focus-within:border-acc-bd focus-within:bg-surface-2 ${sz.box} ${containerClassName}`}
    >
      <Search className={`${sz.icon} text-ink-3 shrink-0 pointer-events-none`} />
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault();
            e.stopPropagation();
            onChange('');
            return;
          }
          onKeyDown?.(e);
        }}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        className={`flex-1 min-w-0 bg-transparent border-0 p-0 text-ink placeholder:text-ink-4 focus:outline-none ${sz.input} ${className}`}
        {...rest}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear filter"
          className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-transparent hover:bg-s3h text-ink-3 hover:text-ink border-0 cursor-pointer shrink-0 p-0"
        >
          <X className="w-3 h-3" />
        </button>
      )}
      {rightSlot}
    </div>
  );
});
