import React from 'react';
import { Tooltip } from '@mantine/core';
import { Users } from 'lucide-react';
import { SubagentSession } from '../../../shared/sessions/types';
import { Type } from '../ui';
import { subagentLabel, subagentUsage } from '../../../shared/sessions/subagents';

interface SubagentTreeProps {
  nodes: SubagentSession[];
  activeSessionId?: string;
  onOpen?: (sessionId: string) => void;
}

export const SubagentTree: React.FC<SubagentTreeProps> = ({
  nodes,
  activeSessionId,
  onOpen
}) => {
  if (nodes.length === 0) return null;

  return (
    <div className="pl-3 flex flex-col gap-0.5">
      {nodes.map((node) => {
        const active = node.sessionId === activeSessionId;
        const label = subagentLabel(node);
        const running = !!node.running;
        const usage = subagentUsage(node);
        const stats = [usage.model, usage.cost, usage.tokens, usage.context].filter(Boolean);
        // The title is the tooltip's job normally, but on a live row saying so
        // is worth more than repeating a title the label already carries.
        const heading = running ? `${label} is running now` : node.title;
        const tip = [
          heading !== label || running ? heading : undefined,
          usage.treeCost && `${usage.treeCost} with its subagents`
        ].filter(Boolean).join(' · ');
        return (
          <div key={node.sessionId} className="flex flex-col gap-0.5">
            <Tooltip label={tip} withArrow disabled={!tip}>
              <button
                type="button"
                aria-current={active ? 'true' : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen?.(node.sessionId);
                }}
                className={`w-full text-left rounded-md px-2 py-1 flex flex-col gap-0.5 border focus:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                  active
                    ? 'border-accent shadow-[0_0_0_1px_var(--acc-bd)] bg-surface'
                    : running
                      ? 'border-run-bd bg-run-bg'
                      : 'border-transparent hover:border-line bg-s3'
                }`}
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <Users className={`w-3 h-3 shrink-0 ${running ? 'text-run-fg' : 'text-ink-3'}`} />
                  <Type role="label" tone={running ? 'run' : 'muted'} className="truncate font-medium">
                    {label}
                  </Type>
                  {running && (
                    // Same pulse the transcript uses for a streaming turn, so
                    // "still going" reads the same wherever it appears.
                    <span
                      aria-label="Running"
                      className="ml-auto shrink-0 w-1.5 h-1.5 rounded-full bg-run animate-pulse motion-reduce:animate-none"
                    />
                  )}
                </span>
                {stats.length > 0 && (
                  // Indented to the label, past the icon, so the line reads as
                  // belonging to this row rather than to the tree.
                  <Type
                    role="meta"
                    className="pl-[18px] truncate"
                    title={usage.contextPct != null ? `Context ${usage.contextPct}% full` : undefined}
                  >
                    {stats.join(' · ')}
                  </Type>
                )}
              </button>
            </Tooltip>
            {node.children.length > 0 && (
              <SubagentTree
                nodes={node.children}
                activeSessionId={activeSessionId}
                onOpen={onOpen}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};
