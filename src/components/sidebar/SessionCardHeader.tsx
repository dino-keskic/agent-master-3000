import { ActionIcon, Group, Menu, Tooltip } from '@mantine/core';
import { FolderInput, MoreVertical, Square, Star } from 'lucide-react';
import { TaskSessionView, isSessionBusy, sessionOriginLabel } from '../../../shared/task/sessions';
import { Chip, Type } from '../ui';
import { SessionStateDot } from '../session/SessionStateDot';

/**
 * The card's top line: what the session is, and the two things you can do to it.
 *
 * The card behind it is itself a click target, so the menu has to stop its
 * clicks from switching session underneath it.
 */

interface SessionCardHeaderProps {
  session: TaskSessionView;
  onStopSession?: (sessionId: string) => void;
  onPromoteSession?: (sessionId: string) => void;
  /** Open the move dialog for this session. Absent while there is nowhere to send it. */
  onRequestMove?: () => void;
}

export const SessionCardHeader: React.FC<SessionCardHeaderProps> = ({
  session,
  onStopSession,
  onPromoteSession,
  onRequestMove
}) => {
  const kindLabel = sessionOriginLabel(session);

  return (
    <Group justify="space-between" align="center" wrap="nowrap" gap={4}>
      <Group gap={5} wrap="nowrap" className="min-w-0">
        <SessionStateDot state={session.runState} />
        <Chip className="shrink-0">{kindLabel}</Chip>
        <Type role="title" size="sm" as="span" className="truncate min-w-0">
          {session.title || 'Session'}
        </Type>
      </Group>

      <Group gap={2} wrap="nowrap" className="shrink-0">
        {session.isPrimary && (
          <Tooltip label="Current session — follow-ups and column runs go here" withArrow>
            <Star className="w-3 h-3 text-wait fill-current" />
          </Tooltip>
        )}
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
            <Menu.Item
              leftSection={<Square className="w-3 h-3 fill-current" />}
              disabled={!isSessionBusy(session.runState)}
              onClick={() => onStopSession?.(session.sessionId)}
            >
              Stop this session
            </Menu.Item>
            <Menu.Item
              leftSection={<Star className="w-3 h-3" />}
              disabled={session.isPrimary}
              onClick={() => onPromoteSession?.(session.sessionId)}
            >
              Make it the main session
            </Menu.Item>
            {onRequestMove && (
              <Menu.Item leftSection={<FolderInput className="w-3 h-3" />} onClick={onRequestMove}>
                Move to project or worktree…
              </Menu.Item>
            )}
          </Menu.Dropdown>
        </Menu>
      </Group>
    </Group>
  );
};
