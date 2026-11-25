import React from 'react';
import { BellOff } from 'lucide-react';
import { NotificationSettings } from '../../../shared/types';
import { DesktopPermission } from '../../../shared/notifications/delivery';
import { NOTIFICATION_EVENT_TOGGLES } from '../../../shared/notifications/settings';
import { Banner, ToggleRow } from '../ui';

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
  <div className="flex flex-col gap-2">
    {permission === 'unsupported' ? (
      <Banner tone="neutral" icon={<BellOff className="w-3.5 h-3.5" />}>
        This browser does not support desktop notifications.
      </Banner>
    ) : permission === 'denied' ? (
      <Banner tone="wait" icon={<BellOff className="w-3.5 h-3.5" />}>
        Desktop notifications are blocked in the browser. Allow them for this site to get alerts while the board is in the background.
      </Banner>
    ) : (
      <ToggleRow
        label="Desktop notifications"
        description={
          permission === 'default'
            ? settings.enabled
              ? 'On for the board, but this browser has not allowed it for this address. Turn it on to allow, then a test is sent.'
              : 'The browser will ask once, then send a test notification.'
            : 'macOS banners while the board is in the background. Send a test to confirm they appear.'
        }
        checked={settings.enabled && permission === 'granted'}
        onChange={(checked) => {
          if (checked) onEnableDesktop();
          else onPatch({ enabled: false });
        }}
      />
    )}

    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {NOTIFICATION_EVENT_TOGGLES.map((toggle) => (
        <ToggleRow
          key={toggle.setting}
          label={toggle.label}
          description={toggle.description}
          checked={settings[toggle.setting]}
          onChange={(checked) => onPatch({ [toggle.setting]: checked })}
          disabled={!settings.enabled}
        />
      ))}
      <ToggleRow
        label="Only while unfocused"
        description="Suppress banners while this tab is in the foreground."
        checked={settings.onlyWhenUnfocused}
        onChange={(checked) => onPatch({ onlyWhenUnfocused: checked })}
        disabled={!settings.enabled}
      />
      <ToggleRow
        label="Play a short tone"
        description="Audible chime when a turn finishes or asks for you."
        checked={settings.sound}
        onChange={(checked) => onPatch({ sound: checked })}
        disabled={!settings.enabled}
      />
    </div>
  </div>
);
