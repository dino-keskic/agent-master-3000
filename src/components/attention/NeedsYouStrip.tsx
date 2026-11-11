import React, { useState } from 'react';
import { AlertTriangle, Check, CircleCheck, MessageCircleQuestion, ShieldQuestion, X } from 'lucide-react';
import { AttentionItem, AttentionKind } from '../../../shared/attention/attention';
import { PermissionAnswer } from '../../../shared/types';
import { Button } from '../ui';
import './attention.css';

/**
 * What is waiting on you, above the columns.
 *
 * A permission prompt is answered where it sits; a question, a failure and a
 * finished turn each open the task at the session that raised them. The strip
 * is not drawn at all when the list is empty — a board with nothing to ask is
 * just its columns. What goes in the list, and in what order, is
 * `shared/attention`.
 */

interface NeedsYouStripProps {
  items: AttentionItem[];
  onOpen: (taskId: string, sessionId?: string) => void;
  onRespond: (taskId: string, answer: PermissionAnswer) => Promise<void>;
  /** Drop a finished turn from the list without opening it. */
  onDismiss: (notificationId: string) => void;
}

const KIND: Record<AttentionKind, { label: string; Icon: React.FC<{ className?: string }>; tone: string }> = {
  permission: { label: 'Wants to run', Icon: ShieldQuestion, tone: 'is-wait' },
  question: { label: 'Asks', Icon: MessageCircleQuestion, tone: 'is-wait' },
  error: { label: 'Failed', Icon: AlertTriangle, tone: 'is-err' },
  review: { label: 'Finished', Icon: CircleCheck, tone: 'is-done' }
};

export const NeedsYouStrip: React.FC<NeedsYouStripProps> = ({ items, onOpen, onRespond, onDismiss }) => {
  // The request being answered: its buttons stay disabled until the snapshot
  // that removes the row arrives, so a double click cannot answer twice.
  const [answering, setAnswering] = useState<string | null>(null);
  if (items.length === 0) return null;

  const answer = async (item: AttentionItem, optionId: string) => {
    if (!item.requestId) return;
    setAnswering(item.id);
    try {
      await onRespond(item.taskId, { kind: 'permission', requestId: item.requestId, optionId });
    } finally {
      setAnswering(null);
    }
  };

  return (
    <section className="needs-you" aria-label="Needs you">
      <h2 className="needs-you-title">
        Needs you <span className="needs-you-count">{items.length}</span>
      </h2>
      <ul className="needs-you-list">
        {items.map((item) => {
          const { label, Icon, tone } = KIND[item.kind];
          const busy = answering === item.id;
          return (
            <li key={item.id} className={`needs-you-item ${tone}`}>
              <button type="button" className="needs-you-body" onClick={() => onOpen(item.taskId, item.sessionId)}>
                <Icon className="needs-you-icon w-4 h-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="needs-you-task">
                    <span className="truncate">{item.taskTitle}</span>
                    {item.projectName && <span className="needs-you-project">{item.projectName}</span>}
                  </span>
                  <span className="needs-you-detail">
                    <span className="needs-you-kind">{label}</span>
                    <span className={`truncate ${item.kind === 'permission' ? 'font-mono text-[12px]' : ''}`}>{item.detail}</span>
                  </span>
                </span>
              </button>
              <span className="needs-you-actions">
                {item.kind === 'permission' && item.allowOptionId && (
                  <Button size="xs" variant="wait" disabled={busy} leftSection={<Check className="w-3 h-3" />} onClick={() => void answer(item, item.allowOptionId!)}>
                    Allow
                  </Button>
                )}
                {item.kind === 'permission' && item.rejectOptionId && (
                  <Button size="xs" variant="secondary" disabled={busy} onClick={() => void answer(item, item.rejectOptionId!)}>
                    Reject
                  </Button>
                )}
                {item.kind === 'question' && (
                  <Button size="xs" variant="wait" onClick={() => onOpen(item.taskId, item.sessionId)}>Answer</Button>
                )}
                {item.kind === 'error' && (
                  <Button size="xs" variant="secondary" onClick={() => onOpen(item.taskId, item.sessionId)}>Open</Button>
                )}
                {item.kind === 'review' && (
                  <>
                    <Button size="xs" variant="secondary" onClick={() => onOpen(item.taskId, item.sessionId)}>Review</Button>
                    {item.notificationId && (
                      <button type="button" className="needs-you-dismiss" aria-label="Dismiss" title="Dismiss" onClick={() => onDismiss(item.notificationId!)}>
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
