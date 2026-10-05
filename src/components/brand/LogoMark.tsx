import React, { useId } from 'react';

/**
 * The board's logo — a prompt chevron driving its columns — drawn on whatever
 * is behind it, at any size.
 *
 * The same mark is `public/favicon.svg`, `desktop/build/icon.svg` (on the
 * square a Mac icon needs) and `docs/logo.svg`; change them together. The
 * viewBox is cropped to the mark so `size` is the mark's own size, not a tile's.
 */
export const LogoMark: React.FC<{ size: number; className?: string }> = ({ size, className }) => {
  // Two marks on one page (header and welcome screen) must not share a gradient id.
  const gradient = `logo-${useId().replace(/:/g, '')}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="8.5 8.5 48 48"
      className={className}
      role="img"
      aria-label="Agent Master 3000"
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <path
        d="M13 21 L23.5 32 L13 43"
        fill="none"
        stroke="#22d3ee"
        strokeWidth={5.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="29" y="16" width="6.5" height="32" rx="3" fill={`url(#${gradient})`} />
      <rect x="39" y="23" width="6.5" height="25" rx="3" fill="#3b82f6" />
      <rect x="49" y="31" width="6.5" height="17" rx="3" fill="#64748b" />
    </svg>
  );
};
