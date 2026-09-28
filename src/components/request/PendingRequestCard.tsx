import React, { useEffect, useState } from 'react';
import { HelpCircle, ShieldQuestion } from 'lucide-react';
import { elapsed } from '../../../shared/format';
import { PendingRequest, PermissionAnswer } from '../../../shared/types';
import { PermissionChoice } from './PermissionChoice';
import { QuestionForm } from './QuestionForm';

interface PendingRequestCardProps {
  request: PendingRequest;
  busy?: boolean;
  onAnswer: (answer: PermissionAnswer) => void;
}

/**
 * Shown when the agent has stopped mid-turn and is blocked on the user —
 * either asking permission to run a tool, or asking a question outright.
 */
export const PendingRequestCard: React.FC<PendingRequestCardProps> = ({ request, busy, onAnswer }) => {
  const isPermission = request.type === 'permission';
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="rounded-lg overflow-hidden border border-wait-bd bg-wait-bg" data-testid="pending-request">
      <div className="flex items-center justify-between gap-2 px-2.5 py-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {isPermission ? (
            <ShieldQuestion className="w-3.5 h-3.5 text-wait-fg shrink-0" />
          ) : (
            <HelpCircle className="w-3.5 h-3.5 text-wait-fg shrink-0" />
          )}
          {isPermission ? (
            <>
              <span className="font-mono text-[12px] font-semibold text-wait-fg shrink-0">
                {request.toolCall.name}
              </span>
              <span className="text-[12px] text-ink-2 truncate min-w-0">
                wants to run {request.toolCall.kind === 'execute' ? 'a command' : request.toolCall.name}
              </span>
            </>
          ) : (
            <span className="font-mono text-[12px] font-semibold text-wait-fg">Agent question</span>
          )}
        </div>
        <span className="font-mono text-[10px] text-wait-fg shrink-0 tabular-nums">
          waiting {elapsed(request.askedAt, now)}
        </span>
      </div>

      {request.type === 'permission' ? (
        <PermissionChoice request={request} busy={busy} onAnswer={onAnswer} />
      ) : (
        <div className="px-2.5 pb-2.5 flex flex-col gap-2">
          <p className="m-0 text-[13px] text-ink whitespace-pre-wrap">{request.message}</p>
          <QuestionForm question={request} busy={busy} onAnswer={onAnswer} />
        </div>
      )}
    </div>
  );
};
