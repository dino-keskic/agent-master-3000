import React from 'react';

/** The small caps heading every block of the task sidebar sits under. */
export const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">{children}</div>
);
