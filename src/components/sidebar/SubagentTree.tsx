import React, { useState } from 'react';
import { Tooltip } from '@mantine/core';
import { Users } from 'lucide-react';
import { SubagentSession } from '../../../shared/sessions/types';
import { keepSubagentInView, subagentLabel, subagentUsage } from '../../../shared/sessions/subagents';
import { collapseToRecent } from '../../../shared/task/showMore';
import { ShowMoreToggle } from './ShowMoreToggle';

interface SubagentTreeProps {
  nodes: SubagentSession[];
  activeSessionId?: string;
  onOpen?: (sessionId: string) => void;
}

/** Compact one-line subagent rows nested under a session's disclosure toggle. */
export const SubagentTree: React.FC<SubagentTreeProps> = ({
  nodes,
  activeSessionId,
  onOpen
}) => {
  const [expanded, setExpanded] = useState(false);
  if (nodes.length === 0) return null;
  const collapsed = collapseToRecent(nodes, {
    addedAt: (node) => (node.createdAt ? Date.parse(node.createdAt) : 0),
    keep: (node) => keepSubagentInView(node, activeSessionId)
  });
  const shown = expanded ? nodes : collapsed.visible;

  return (
    <div className="pl-5 flex flex-col gap-0.5">
      {shown.map((node) => {
        const active = node.sessionId === activeSessionId;
        const label = subagentLabel(node);
        const running = !!node.running;
        const usage = subagentUsage(node);
        const heading = running ? `${label} is running now` : node.title;
        const tip = [
          heading !== label || running ? heading : undefined,
          usage.model,
          usage.tokens,
          usage.context ? `Context ${usage.context}` : undefined,
          usage.treeCost && `${usage.treeCost} with its subagents`
        ]
          .filter(Boolean)
          .join(' · ');

        return (
          <div key={node.sessionId} className="flex flex-col gap-0.5">
            <Tooltip label={tip} withArrow position="left" disabled={!tip}>
              <button
                type="button"
                aria-current={active ? 'true' : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen?.(node.sessionId);
                }}
                className={`w-full text-left rounded-md px-2 py-1 flex items-center justify-between gap-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                  active
                    ? 'bg-acc-bg shadow-[inset_0_0_0_1px_var(--acc-bd)]'
                    : running
                      ? 'bg-run-bg'
                      : 'hover:bg-s3h'
                }`}
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <Users className={`w-3 h-3 shrink-0 ${running ? 'text-run-fg' : 'text-ink-4'}`} />
                  <span className={`text-[12px] truncate ${running ? 'text-run-fg font-medium' : 'text-ink-2'}`}>
                    {label}
                  </span>
                  {running && (
                    <span
                      aria-label="Running"
                      className="shrink-0 w-1.5 h-1.5 rounded-full bg-run animate-pulse motion-reduce:animate-none"
                    />
                  )}
                </span>
                {usage.cost && (
                  <span className="font-mono text-[11px] text-ink-4 shrink-0 tabular-nums">{usage.cost}</span>
                )}
              </button>
            </Tooltip>
            {node.children.length > 0 && (
              <SubagentTree nodes={node.children} activeSessionId={activeSessionId} onOpen={onOpen} />
            )}
          </div>
        );
      })}
      <ShowMoreToggle
        hiddenCount={collapsed.hiddenCount}
        expanded={expanded}
        onToggle={() => setExpanded((open) => !open)}
      />
    </div>
  );
};
