import React from 'react';
import { AlertCircle } from 'lucide-react';
import { highlight } from '../../../shared/transcript/highlight';
import { executeCommand } from '../../../shared/agent/backgroundTasks';
import { isApproval, sortPermissionOptions } from '../../../shared/agent/permissions';
import { PendingPermission, PermissionAnswer, PermissionOptionKind } from '../../../shared/types';
import { HighlightedCode } from '../stream/HighlightedCode';
import { Button } from '../ui';

/**
 * The tool the agent wants to run, spelled out — what it is called, what it
 * would touch, and the arguments it would go with — and the answers the agent
 * itself offered.
 */

interface PermissionChoiceProps {
  request: PendingPermission;
  busy?: boolean;
  onAnswer: (answer: PermissionAnswer) => void;
}

function buttonProps(kind: PermissionOptionKind): { variant: 'wait' | 'secondary'; className?: string } {
  if (kind === 'allow_once') return { variant: 'wait' };
  if (kind === 'allow_always' || isApproval(kind)) {
    return { variant: 'secondary', className: 'border-wait-bd text-wait-fg hover:bg-wait-bg' };
  }
  return { variant: 'secondary', className: 'hover:border-err-bd hover:text-err-fg' };
}

export const PermissionChoice: React.FC<PermissionChoiceProps> = ({ request, busy, onAnswer }) => {
  const command = executeCommand(request.toolCall);
  const options = sortPermissionOptions(request.options);

  return (
    <div className="flex flex-col gap-2 pb-2.5">
      {command && (
        <pre className="mx-2.5 m-0 px-[9px] py-[7px] rounded-md bg-code border border-wait-bd font-mono text-[11.5px] leading-[1.55] text-ink overflow-x-auto">
          <span className="text-wait-fg select-none">❯ </span>
          <HighlightedCode tokens={highlight(command, 'bash')} />
        </pre>
      )}

      {!command && request.toolCall.locations && request.toolCall.locations.length > 0 && (
        <p className="mx-2.5 m-0 font-mono text-[12px] text-ink-2 break-all">
          {request.toolCall.locations.join('\n')}
        </p>
      )}

      {!command && request.toolCall.rawInput && Object.keys(request.toolCall.rawInput).length > 0 && (
        <pre className="mx-2.5 m-0 p-2.5 rounded bg-code border border-line/80 text-log-code text-ink-2 overflow-x-auto font-mono max-h-40">
          {JSON.stringify(request.toolCall.rawInput, null, 2)}
        </pre>
      )}

      <div className="flex items-center gap-2 px-2.5 flex-wrap">
        {options.map((option) => {
          const props = buttonProps(option.kind);
          return (
            <Button
              key={option.optionId}
              size="xs"
              variant={props.variant}
              className={props.className}
              disabled={busy}
              onClick={() =>
                onAnswer({ kind: 'permission', requestId: request.requestId, optionId: option.optionId })
              }
            >
              {option.name}
            </Button>
          );
        })}
        {options.length === 0 && (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-2">
            <AlertCircle className="w-3.5 h-3.5" />
            The agent offered no options — stop the task to unblock it.
          </span>
        )}
      </div>
    </div>
  );
};
