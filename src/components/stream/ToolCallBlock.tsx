import React, { useMemo, useState } from 'react';
import { Collapse, Tooltip, UnstyledButton } from '@mantine/core';
import { ToolCallInfo } from '../../../shared/types';
import { executeCommand } from '../../../shared/agent/backgroundTasks';
import { isSubagentTool } from '../../../shared/agent/toolCall';
import { editDiff } from '../../../shared/agent/editDiff';
import { isTerminalTool, skillNameOf } from '../../../shared/agent/toolCallView';
import { ToolCallRow } from './toolCall/ToolCallRow';
import { TerminalBody, ToolBody, ToolFileList } from './toolCall/ToolCallBodies';
import { EditDiffBody } from './toolCall/EditDiffBody';
import { ChevronRight } from 'lucide-react';
import { Surface, SurfaceBorder } from '../ui';

interface ToolCallBlockProps {
  info: ToolCallInfo;
  timestamp: number;
  /** Present when the transcript can navigate to the child session this call started. */
  onOpenSubagent?: (sessionId: string) => void;
}

/**
 * One tool call in a transcript: a row that is always there, and detail behind
 * a chevron. The row and the panes are in `toolCall/`; what is here is which of
 * them a call gets, and what clicking it does.
 */
export const ToolCallBlock: React.FC<ToolCallBlockProps> = React.memo(({ info, timestamp, onOpenSubagent }) => {
  const terminal = isTerminalTool(info);
  // An edit's own output says only "Edit applied successfully", so what the
  // call did has to be reconstructed from its input. A failed one keeps the
  // JSON body: there the output is the error, and it is the point.
  const diff = useMemo(() => (terminal || info.status === 'failed' ? null : editDiff(info)), [terminal, info]);
  const [open, setOpen] = useState(
    () => terminal && (info.status === 'in_progress' || info.status === 'failed')
  );
  const hasDetail = !!info.rawInput || !!info.output;
  const toggle = () => hasDetail && setOpen((o) => !o);

  // A `task` call is a doorway, not a result: the work it stands for happened
  // in a session of its own. Clicking the row goes there; the chevron still
  // opens the call's own input and output where it sits.
  const childSessionId = isSubagentTool(info.name) ? info.subagentSessionId : undefined;
  const opensChild = !!childSessionId && !!onOpenSubagent;

  const live = info.status === 'in_progress';
  const row = <ToolCallRow info={info} timestamp={timestamp} opensChild={opensChild} />;
  const borderType: SurfaceBorder = opensChild || (skillNameOf(info) !== undefined && !live && info.status !== 'failed')
    ? 'accent'
    : live
      ? 'run'
      : info.status === 'failed'
        ? 'err'
        : 'default';

  return (
    <Surface
      level={live ? 's2' : 's1'}
      border={borderType}
      radius="md"
      className="overflow-hidden"
    >
      <div className="w-full flex items-stretch">
        {hasDetail ? (
          <UnstyledButton
            onClick={toggle}
            aria-expanded={open}
            aria-label={open ? 'Hide tool details' : 'Show tool details'}
            className="pl-2.5 pr-1 py-[7px] flex items-center shrink-0 hover:bg-surface-2 transition-colors"
          >
            <ChevronRight className={`w-3 h-3 text-ink-4 transition-transform ${open ? 'rotate-90' : ''}`} />
          </UnstyledButton>
        ) : (
          <span className="pl-2.5 pr-1 w-[22px] shrink-0" />
        )}
        {opensChild ? (
          <Tooltip label={`Open the ${info.subagentName || 'subagent'} session`} withArrow position="top-start">
            <UnstyledButton
              onClick={() => onOpenSubagent(childSessionId)}
              className="min-w-0 flex-1 pr-2.5 py-[7px] tool-name hover:bg-acc-bg transition-colors"
            >
              {row}
            </UnstyledButton>
          </Tooltip>
        ) : (
          <UnstyledButton
            onClick={toggle}
            className={`min-w-0 flex-1 pr-2.5 py-[7px] tool-name ${hasDetail ? 'hover:bg-surface-2' : 'cursor-default'} transition-colors`}
          >
            {row}
          </UnstyledButton>
        )}
      </div>

      <Collapse in={open}>
        <div className="px-2.5 pb-2.5 pt-0.5 space-y-2 border-t border-hairline">
          {terminal ? (
            <TerminalBody info={info} command={executeCommand(info)} />
          ) : diff ? (
            <EditDiffBody diff={diff} rawInput={info.rawInput} />
          ) : (
            <ToolBody info={info} />
          )}
          {info.locations && info.locations.length > 1 && <ToolFileList locations={info.locations} />}
        </div>
      </Collapse>
      {live && (
        <div className="tool-sweep-track">
          <div className="tool-sweep" />
        </div>
      )}
    </Surface>
  );
});
