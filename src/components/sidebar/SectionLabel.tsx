import React from 'react';

/** The small caps heading every block of the task sidebar sits under. */
export const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="type-meta uppercase tracking-[0.06em] text-ink-3 font-medium">{children}</div>
);
