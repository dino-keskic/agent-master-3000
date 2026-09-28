import React from 'react';
import { WandSparkles } from 'lucide-react';

/**
 * A skill or command, named the way it was invoked. Used where a message was
 * sent with `/name` and where the agent loaded a skill itself, so both read as
 * the same thing and stand out from the prose and tool calls around them.
 */
export const SkillChip: React.FC<{ name: string; slash?: boolean; title?: string }> = ({ name, slash = false, title }) => (
  <span
    title={title}
    className="inline-flex items-center gap-1 min-w-0 max-w-full rounded-md px-1.5 py-px bg-acc-bg border border-acc-bd text-acc-fg font-mono text-[11.5px] font-medium align-middle"
  >
    <WandSparkles className="w-3 h-3 shrink-0" />
    <span className="truncate">{slash ? `/${name}` : name}</span>
  </span>
);
