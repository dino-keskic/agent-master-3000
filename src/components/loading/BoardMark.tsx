import React from 'react';
import { LogoMark } from '../brand/LogoMark';

/**
 * The board's identity, at the one size the loading screen needs it.
 *
 * Same logo and wordmark the header wears, scaled up: on a cold start this is
 * the only thing on screen, so it has to read as the app and not as a spinner
 * someone forgot to label.
 */
export const BoardMark: React.FC = () => (
  <div className="flex items-center gap-3">
    <LogoMark size={48} />
    <div className="flex flex-col items-start gap-1">
      <h1 className="text-[22px] font-bold tracking-[-0.02em] text-ink m-0 leading-none">
        Agent Master 3000
      </h1>
      <span className="font-mono text-[11px] leading-none text-ink-4">OpenCode ACP</span>
    </div>
  </div>
);
