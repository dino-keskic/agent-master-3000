import React from 'react';
import { LayoutGrid } from 'lucide-react';

/**
 * The board's identity, at the one size the loading screen needs it.
 *
 * Same tile and wordmark the header wears, scaled up: on a cold start this is
 * the only thing on screen, so it has to read as the app and not as a spinner
 * someone forgot to label.
 */
export const BoardMark: React.FC = () => (
  <div className="flex items-center gap-3">
    <div className="bg-acc-tile rounded-xl p-2.5 shadow-card">
      <LayoutGrid className="w-6 h-6 text-white" />
    </div>
    <div className="flex flex-col items-start gap-1">
      <h1 className="text-[22px] font-bold tracking-[-0.02em] text-ink m-0 leading-none">
        Agent Master 3000
      </h1>
      <span className="font-mono text-[11px] leading-none text-ink-4">OpenCode ACP</span>
    </div>
  </div>
);
