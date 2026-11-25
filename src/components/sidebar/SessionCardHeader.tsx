import { ActionIcon, Menu } from '@mantine/core';
import { FolderInput, GitFork, MoreVertical, Square, Star } from 'lucide-react';
import { TaskSessionView, isSessionBusy } from '../../../shared/task/sessions';

/**
 * Hover-revealed action menu on a session row.
 *
 * The row behind it is itself a click target, so clicks on the menu stop
 * propagation before they can switch the session underneath.
 */

interface SessionCardHeaderProps {
  session: TaskSessionView;
  onForkSession?: () => void;
  onStopSession?: (sessionId: string) => void;
  onPromoteSession?: (sessionId: string) => void;
  /** Open the move dialog for this session. Absent while there is nowhere to send it. */
  onRequestMove?: () => void;
}

export const SessionCardHeader: React.FC<SessionCardHeaderProps> = ({
  session,
  onForkSession,
  onStopSession,
  onPromoteSession,
  onRequestMove
}) => (
  <span className="session-row-actions">
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="xs"
          aria-label="Session actions"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreVertical className="w-3 h-3" />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
        {onForkSession && (
          <Menu.Item leftSection={<GitFork className="w-3 h-3" />} onClick={onForkSession}>
            Fork from end…
          </Menu.Item>
        )}
        <Menu.Item
          leftSection={<Star className="w-3 h-3" />}
          disabled={session.isPrimary}
          onClick={() => onPromoteSession?.(session.sessionId)}
        >
          Make main thread
        </Menu.Item>
        <Menu.Item
          leftSection={<Square className="w-3 h-3 fill-current" />}
          disabled={!isSessionBusy(session.runState)}
          onClick={() => onStopSession?.(session.sessionId)}
        >
          Stop this session
        </Menu.Item>
        {onRequestMove && (
          <Menu.Item leftSection={<FolderInput className="w-3 h-3" />} onClick={onRequestMove}>
            Move to project or worktree…
          </Menu.Item>
        )}
      </Menu.Dropdown>
    </Menu>
  </span>
);
