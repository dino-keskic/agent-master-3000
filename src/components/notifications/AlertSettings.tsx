import React from 'react';
import { Checkbox, Stack, Switch, Text } from '@mantine/core';
import { NotificationSettings } from '../../../shared/types';
import { DesktopPermission } from '../../../shared/notifications/delivery';
import { NOTIFICATION_EVENT_TOGGLES } from '../../../shared/notifications/settings';

export type { DesktopPermission };

interface AlertSettingsProps {
  settings: NotificationSettings;
  permission: DesktopPermission;
  onPatch: (partial: Partial<NotificationSettings>) => void;
  onEnableDesktop: () => void;
}

/**
 * When the board is allowed to interrupt. The master switch is the browser's
 * to grant, so it is the only one that cannot simply be flipped here: turning
 * it on runs the permission prompt, and a browser that has already refused
 * says so instead of offering a switch that would do nothing.
 */
export const AlertSettings: React.FC<AlertSettingsProps> = ({
  settings,
  permission,
  onPatch,
  onEnableDesktop
}) => (
  <Stack gap={8} p="sm" className="shrink-0 border-b border-line/50 bg-canvas/40">
    {permission === 'unsupported' ? (
      <Text size="xs" c="dimmed" className="font-mono">
        This browser does not support desktop notifications.
      </Text>
    ) : permission === 'denied' ? (
      <Text size="xs" c="dimmed">
        Desktop notifications are blocked in the browser. Allow them for this site to get alerts while the board is in the background.
      </Text>
    ) : (
      <Switch
        size="xs"
        label="Desktop notifications"
        description={
          permission === 'default'
            ? settings.enabled
              ? 'On for the board, but this browser has not allowed it for this address. Turn it on to allow, then a test is sent.'
              : 'The browser will ask once, then send a test notification.'
            : 'macOS banners while the board is in the background. Send a test to confirm they appear.'
        }
        checked={settings.enabled && permission === 'granted'}
        onChange={(event) => {
          if (event.currentTarget.checked) onEnableDesktop();
          else onPatch({ enabled: false });
        }}
      />
    )}
    {NOTIFICATION_EVENT_TOGGLES.map((toggle) => (
      <Checkbox
        key={toggle.setting}
        size="xs"
        label={toggle.label}
        description={toggle.description}
        checked={settings[toggle.setting]}
        onChange={(event) => onPatch({ [toggle.setting]: event.currentTarget.checked })}
        disabled={!settings.enabled}
      />
    ))}
    <Checkbox
      size="xs"
      label="Only while this tab is in the background"
      checked={settings.onlyWhenUnfocused}
      onChange={(event) => onPatch({ onlyWhenUnfocused: event.currentTarget.checked })}
      disabled={!settings.enabled}
    />
    <Checkbox
      size="xs"
      label="Play a short tone"
      checked={settings.sound}
      onChange={(event) => onPatch({ sound: event.currentTarget.checked })}
      disabled={!settings.enabled}
    />
  </Stack>
);
