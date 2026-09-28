import React from 'react';

/**
 * The board's type. The sizes live in `src/index.css` under `.type-*`; this is
 * the way a screen asks for one, so a card and the session beside it cannot
 * drift apart by each inventing a `text-[11px]`.
 *
 * Color is a separate choice (`tone`) and only one is applied. Two Tailwind
 * color classes on the same node do not compose — whichever was generated
 * last wins, no matter the order in `className`.
 */

export type TypeRole = 'title' | 'copy' | 'meta' | 'stat' | 'label';
export type TypeTone = 'ink' | 'muted' | 'faint' | 'run' | 'wait' | 'accent' | 'err';

const ROLE: Record<TypeRole, string> = {
  title: 'type-title',
  copy: 'type-copy',
  meta: 'type-meta-line',
  stat: 'type-stat',
  label: 'type-label'
};

const COLOR: Record<TypeRole, string> = {
  title: 'text-ink',
  copy: 'text-ink-2',
  meta: 'text-ink-3',
  stat: 'text-ink-2',
  label: 'text-ink-3'
};

const TONE: Record<TypeTone, string> = {
  ink: 'text-ink',
  muted: 'text-ink-2',
  faint: 'text-ink-3',
  run: 'text-run-fg',
  wait: 'text-wait-fg',
  accent: 'text-acc-fg',
  err: 'text-err-fg'
};

type TypeTag = 'span' | 'p' | 'h3' | 'div';

export const Type = React.forwardRef<
  HTMLElement,
  {
    role: TypeRole;
    /** Narrow titles, for the session column. A card heading leaves this off. */
    size?: 'sm';
    tone?: TypeTone;
    as?: TypeTag;
  } & Omit<React.HTMLAttributes<HTMLElement>, 'role'>
>(function Type({ role, size, tone, as, className = '', ...rest }, ref) {
  const Tag = as ?? (role === 'copy' ? 'p' : role === 'title' ? 'h3' : 'span');
  return (
    <Tag
      ref={ref as never}
      className={[ROLE[role], size === 'sm' && role === 'title' ? 'is-sm' : '', tone ? TONE[tone] : COLOR[role], className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    />
  );
});
