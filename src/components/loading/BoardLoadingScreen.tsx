import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { BoardLoadState } from '../../../shared/board/load';
import { Button } from '../ui/Button';
import { BoardLoadingDots } from './BoardLoadingDots';
import { BoardMark } from './BoardMark';

/**
 * What the user looks at before the board exists.
 *
 * It renders a `BoardLoadState` and nothing else — whether it should be on
 * screen at all, and what it says, were decided in `shared/board/load.ts`. The
 * only behaviour here is the retry, which is the board's own `refresh`.
 */

interface BoardLoadingScreenProps {
  state: BoardLoadState;
  onRetry: () => void;
}

export const BoardLoadingScreen: React.FC<BoardLoadingScreenProps> = ({ state, onRetry }) => {
  const failed = state.phase === 'failed';

  return (
    <div
      className="min-h-screen bg-canvas text-ink font-sans flex items-center justify-center p-8"
      role="status"
      aria-live="polite"
      aria-busy={!failed}
    >
      <div className="flex flex-col items-center gap-6 text-center max-w-[420px]">
        <BoardMark />

        <div className="flex flex-col items-center gap-3">
          {failed ? (
            <span className="inline-flex items-center gap-2 text-err-fg">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="text-log font-medium">Could not load the board</span>
            </span>
          ) : (
            <BoardLoadingDots />
          )}

          <p className="m-0 text-log-ui text-ink-3 break-words">{state.message}</p>
        </div>

        {state.canRetry && (
          <Button
            variant="primary"
            size="md"
            onClick={onRetry}
            leftSection={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Try again
          </Button>
        )}
      </div>
    </div>
  );
};
