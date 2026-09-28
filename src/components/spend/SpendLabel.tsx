import React from 'react';
import { Text, Tooltip } from '@mantine/core';
import { contextFillPct, formatContext, formatUsd } from '../../../shared/sessions/cost';

interface SpendLabelProps {
  cost?: number;
  contextTokens?: number;
  contextLimit?: number;
  subagentCount?: number;
  prefix?: string;
}

export const SpendLabel: React.FC<SpendLabelProps> = ({ cost, contextTokens, contextLimit, subagentCount, prefix = '' }) => {
  const usd = formatUsd(cost);
  const ctx = formatContext(contextTokens, contextLimit);
  const pct = contextFillPct(contextTokens, contextLimit);
  if (!usd && !ctx) return null;
  const costLabel = subagentCount
    ? `API cost including ${subagentCount} subagent${subagentCount === 1 ? '' : 's'}`
    : 'API cost for this session including subagents';

  return (
    <>
      {usd && (
        <Tooltip label={costLabel} withArrow>
          <Text size="xs" className="font-mono text-ink-2 text-[11px] shrink-0">
            {prefix}{usd}
          </Text>
        </Tooltip>
      )}
      {ctx && (
        <Tooltip
          label={pct != null ? `Last turn used ${pct}% of the context window` : 'Last turn context size'}
          withArrow
        >
          <Text size="xs" className="font-mono text-ink-3 text-[11px] shrink-0">
            {prefix && !usd ? prefix : ''}{ctx}
          </Text>
        </Tooltip>
      )}
    </>
  );
};
