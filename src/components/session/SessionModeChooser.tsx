import { GitFork, Plus } from 'lucide-react';
import { SegmentedControl, Surface } from '../ui';
import { MODE_COPY, SessionStartMode } from './sessionMode';

/**
 * Which kind of session is being started, and what that choice means.
 *
 * A fork copies a session's messages, so the copy starts knowing what the
 * original knew; blank starts empty. The panel under the buttons names what
 * would be copied, because the two look identical once they are open.
 */
export function SessionModeChooser({
  mode,
  canFork,
  taskTitle,
  sourceTitle,
  onModeChange
}: {
  mode: SessionStartMode;
  /** False when the task has never run — there is nothing to fork yet. */
  canFork: boolean;
  taskTitle: string;
  sourceTitle?: string;
  onModeChange: (mode: SessionStartMode) => void;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      {canFork && (
        <div>
          <SegmentedControl<SessionStartMode>
            size="sm"
            value={mode}
            onChange={onModeChange}
            options={[
              { value: 'fork', label: 'Fork session', icon: <GitFork className="w-3.5 h-3.5" /> },
              { value: 'new', label: 'Blank session', icon: <Plus className="w-3.5 h-3.5" /> }
            ]}
          />
        </div>
      )}

      <Surface level="s1" border="default" radius="lg" className="p-3 flex flex-col gap-1">
        <span className="text-[12px] text-ink-3 leading-relaxed">
          {MODE_COPY[mode].help}
        </span>
        {mode === 'fork' && sourceTitle && (
          <span className="text-[12px] text-ink-2">
            Copying <span className="font-semibold text-acc-fg">{sourceTitle}</span> on{' '}
            <span className="font-semibold text-ink">{taskTitle}</span>
          </span>
        )}
      </Surface>
    </div>
  );
}
