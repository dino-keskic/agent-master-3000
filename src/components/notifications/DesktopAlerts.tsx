import React, { useState } from 'react';
import { Text } from '@mantine/core';
import { NotificationSettings } from '../../../shared/types';
import { describeDelivery, DesktopPermission, NotificationDelivery } from '../../../shared/notifications/delivery';
import { AlertSettings } from './AlertSettings';

/**
 * The desktop-alert section of Settings: the switches, a test, and what the
 * last attempt did.
 *
 * It used to sit folded inside the notification inbox, where a preference
 * pushed the list it was about off the screen. The result line is kept right
 * under the button because this is the only place that can tell "the browser
 * refused" from "the OS ate the banner" — without it both read as a button
 * that does nothing.
 */

interface DesktopAlertsProps {
  settings: NotificationSettings;
  permission: DesktopPermission;
  onPatch: (partial: Partial<NotificationSettings>) => void;
  onEnableDesktop: () => Promise<NotificationDelivery>;
  onTestDesktop: () => Promise<NotificationDelivery>;
}

export const DesktopAlerts: React.FC<DesktopAlertsProps> = ({
  settings,
  permission,
  onPatch,
  onEnableDesktop,
  onTestDesktop
}) => {
  const [delivery, setDelivery] = useState<NotificationDelivery | null>(null);
  const report = (run: () => Promise<NotificationDelivery>) => {
    void run().then(setDelivery, (err: unknown) => {
      setDelivery({ ok: false, reason: 'failed', detail: err instanceof Error ? err.message : String(err) });
    });
  };
  const described = delivery ? describeDelivery(delivery) : undefined;

  return (
    <div className="flex flex-col gap-3">
      <AlertSettings
        settings={settings}
        permission={permission}
        onPatch={onPatch}
        onEnableDesktop={() => report(onEnableDesktop)}
      />
      {settings.enabled && permission === 'granted' && (
        <div>
          <button type="button" className="hdr-btn h-7 px-2.5 text-[12px]" onClick={() => report(onTestDesktop)}>
            Send a test
          </button>
        </div>
      )}
      {described && (
        <Text size="sm" c={described.tone === 'ok' ? undefined : 'orange.4'}>
          {described.text}
        </Text>
      )}
    </div>
  );
};
