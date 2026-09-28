import { Group, Menu, Text } from '@mantine/core';
import { ListTree } from 'lucide-react';
import { TaskLogItem } from '../../../shared/types';
import { relativeTime } from '../../../shared/format';
import { Button } from '../ui';

/** Every prompt in the session, as a way back to the one you are looking for. */

/** First line, short enough for a menu item; a jump target, not a full quote. */
function messagePreview(text: string, max = 64): string {
  const firstLine = text.trim().split('\n')[0] || '';
  return firstLine.length > max ? `${firstLine.slice(0, max)}…` : firstLine || '(empty)';
}

interface JumpToMessageProps {
  messages: TaskLogItem[];
  onJump: (log: TaskLogItem) => void;
}

export const JumpToMessage: React.FC<JumpToMessageProps> = ({ messages, onJump }) => (
  <Menu position="bottom-end" withinPortal>
    <Menu.Target>
      <Button variant="ghost" size="xs" leftSection={<ListTree className="w-3 h-3" />}>
        Jump to message
      </Button>
    </Menu.Target>
    <Menu.Dropdown className="max-h-80 overflow-y-auto">
      <Menu.Label>{messages.length} message{messages.length === 1 ? '' : 's'}</Menu.Label>
      {messages.map((log) => (
        <Menu.Item key={log.id} onClick={() => onJump(log)}>
          <Group gap={8} wrap="nowrap">
            <Text size="xs" c="dimmed" className="font-mono shrink-0">
              {relativeTime(log.timestamp)}
            </Text>
            <Text size="xs" className="truncate">{messagePreview(log.text)}</Text>
          </Group>
        </Menu.Item>
      ))}
    </Menu.Dropdown>
  </Menu>
);
