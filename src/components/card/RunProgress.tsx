import React, { useEffect, useState } from 'react';
import { ArrowRight, Loader2, Terminal } from 'lucide-react';
import { elapsed } from '../../../shared/format';
import { TaskCardTool } from '../../../shared/task/card';

/** The live tool box on a running card, plus the next queued prompt if any. */

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export const RunProgress: React.FC<{
  tool: TaskCardTool;
  nextPrompt?: string;
}> = ({ tool, nextPrompt }) => {
  const now = useNow();
  const duration = elapsed(tool.startedAt, now);

  return (
    <div className="flex flex-col gap-3">
      <div className="border border-run-bd rounded-[9px] bg-surface-2 overflow-hidden">
        <div className="flex items-center gap-[7px] px-[9px] pt-[7px] pb-1.5">
          <Loader2 className="w-3 h-3 text-run-fg animate-spin shrink-0" />
          <span className="text-[11.5px] font-semibold text-ink flex-1 min-w-0 truncate">{tool.title}</span>
          {tool.stepBadge && (
            <span className="font-mono text-[10px] text-ink-3 shrink-0">{tool.stepBadge}</span>
          )}
          {!tool.command && (
            <span className="font-mono text-[10px] text-ink-4 shrink-0 tabular-nums">{duration}</span>
          )}
        </div>
        {tool.command && (
          <div className="flex items-center gap-1.5 px-[9px] pb-[7px]">
            <Terminal className="w-[11px] h-[11px] text-ink-4 shrink-0" />
            <span className="font-mono text-[10.5px] text-ink-3 flex-1 min-w-0 truncate">{tool.command}</span>
            <span className="font-mono text-[10px] text-ink-4 shrink-0 tabular-nums">{duration}</span>
          </div>
        )}
        <div className="tool-sweep-track">
          {tool.progressPercent != null ? (
            <div
              className="h-full bg-run transition-all duration-300"
              style={{ width: `${Math.max(4, Math.min(100, tool.progressPercent))}%` }}
            />
          ) : (
            <div className="tool-sweep" />
          )}
        </div>
      </div>

      {nextPrompt && (
        <div className="flex items-center gap-1.5 px-px">
          <ArrowRight className="w-[11px] h-[11px] text-ink-4 shrink-0" />
          <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-ink-4 shrink-0">Next</span>
          <span className="text-[11.5px] text-ink-3 flex-1 min-w-0 truncate">{nextPrompt}</span>
        </div>
      )}
    </div>
  );
};
