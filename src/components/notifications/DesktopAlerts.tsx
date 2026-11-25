import React, { useState } from 'react';
import { BellRing } from 'lucide-react';
import { NotificationSettings } from '../../../shared/types';
import { describeDelivery, DesktopPermission, NotificationDelivery } from '../../../shared/notifications/delivery';
import { Banner, Button } from '../ui';
import { AlertSettings } from './AlertSettings';

/**
 * The desktop-alert section of Settings: the switches, a test, and what the
 * last attempt did.
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
    <div className="flex flex-col gap-2.5">
      <AlertSettings
        settings={settings}
        permission={permission}
        onPatch={onPatch}
        onEnableDesktop={() => report(onEnableDesktop)}
      />
      {settings.enabled && permission === 'granted' && (
        <div className="flex items-center gap-2">
          <Button
            size="xs"
            variant="secondary"
            leftSection={<BellRing className="w-3 h-3" />}
            onClick={() => report(onTestDesktop)}
          >
            Send a test alert
          </Button>
        </div>
      )}
      {described && (
        <Banner tone={described.tone === 'ok' ? 'run' : 'wait'}>
          {described.text}
        </Banner>
      )}
    </div>
  );
};
