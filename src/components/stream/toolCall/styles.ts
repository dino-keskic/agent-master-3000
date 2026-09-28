import { ToolCallInfo } from '../../../../shared/types';

/** The looks the tool-call row and panes share, kept here so they stay identical. */
export const SECTION_LABEL = 'text-meta uppercase tracking-[0.08em] font-mono text-ink-3';
export const CODE_PANE =
  'p-2 rounded-md bg-code border border-line text-log-code text-ink-2 font-mono overflow-x-auto';
export const ERROR_BADGE =
  'font-mono text-[10px] rounded px-1.5 py-0.5 bg-err-bg text-err-fg border border-err-bd';

/*
 * Status carries a colour now. A transcript is mostly tool calls, and when they
 * are all the same grey the one that failed is as quiet as the fifty that
 * worked — which is exactly backwards from what you are scanning for.
 */
export const STATUS_STYLES: Record<ToolCallInfo['status'], { color: string; border: string; label: string }> = {
  pending: { color: 'text-ink-4', border: 'border-line', label: 'Pending' },
  in_progress: { color: 'text-run-fg', border: 'border-run-bd', label: 'Running' },
  completed: { color: 'text-ink-2', border: 'border-line', label: 'Done' },
  failed: { color: 'text-err-fg', border: 'border-err-bd', label: 'Failed' }
};
