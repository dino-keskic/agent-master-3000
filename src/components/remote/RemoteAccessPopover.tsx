import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader, Popover, Tooltip } from '@mantine/core';
import { Check, Copy, Globe, Moon, Smartphone, Wifi } from 'lucide-react';
import { api } from '../../api';
import {
  buildRemoteAccessTargets,
  defaultRemoteAccessMode,
  RemoteAccessMode,
  RemoteAccessStatus,
  remoteSessionUrl
} from '../../../shared/http/remoteAccess';
import { encodeQr, qrSvgPath } from '../../../shared/http/qr';
import { TailscaleSetupCard } from './TailscaleSetupCard';

/**
 * One-click phone remote access popover for a task session (Wi-Fi LAN or Tailscale).
 *
 * Opening the popover starts the token-protected secondary listener if off, or
 * refreshes live Tailscale status if already running, rendering a scannable QR code,
 * copyable deep link, HTTPS toggle, and macOS idle-sleep prevention control.
 */

interface RemoteAccessPopoverProps {
  taskId: string;
  sessionId?: string;
}

/** ISO/IEC 18004 standard 4-module quiet zone around the QR symbol. */
const QR_QUIET_MODULES = 4;

export const RemoteAccessPopover: React.FC<RemoteAccessPopoverProps> = ({ taskId, sessionId }) => {
  const [opened, setOpened] = useState(false);
  const [status, setStatus] = useState<RemoteAccessStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<RemoteAccessMode | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);

  // Read live listener status once on mount so the green indicator dot stays
  // accurate when remote access was already enabled from another panel.
  useEffect(() => {
    let cancelled = false;
    api.getRemoteAccess()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    };
  }, []);

  const runAction = async (fn: () => Promise<RemoteAccessStatus>, fallbackMsg: string) => {
    setBusy(true);
    setError(null);
    try {
      const next = await fn();
      setStatus(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : fallbackMsg);
    } finally {
      setBusy(false);
    }
  };

  const enable = () => runAction(() => api.enableRemoteAccess(), 'Could not enable phone access');
  const disable = () => runAction(() => api.disableRemoteAccess(), 'Could not disable phone access');
  const refresh = () => runAction(() => api.getRemoteAccess(), 'Could not refresh status');
  const enableHttps = () =>
    runAction(() => api.enableTailscaleHttps(), 'Could not enable Tailscale HTTPS');
  const disableHttps = () =>
    runAction(() => api.disableTailscaleHttps(), 'Could not disable Tailscale HTTPS');

  const handleTriggerClick = () => {
    if (opened) {
      setOpened(false);
      return;
    }
    setOpened(true);
    if (!status?.enabled && !busy) {
      void enable();
    } else if (status?.enabled && !busy) {
      void refresh();
    }
  };

  // Derive active mode and target during render so refreshes never need sync effects.
  const activeMode = selectedMode ?? defaultRemoteAccessMode(status);
  const allTargets = useMemo(() => buildRemoteAccessTargets(status), [status]);
  const modeTargets = useMemo(
    () => allTargets.filter((target) => target.mode === activeMode),
    [allTargets, activeMode]
  );
  const activeTarget =
    (selectedTargetId && modeTargets.find((target) => target.id === selectedTargetId)) ||
    modeTargets[0];

  const shareUrl = useMemo(() => {
    if (!status?.enabled || !activeTarget) return null;
    return remoteSessionUrl({
      protocol: activeTarget.protocol,
      host: activeTarget.host,
      port: activeTarget.port,
      token: status.token,
      taskId,
      sessionId
    });
  }, [status, activeTarget, taskId, sessionId]);

  const qr = useMemo(() => {
    if (!shareUrl) return null;
    try {
      const matrix = encodeQr(shareUrl);
      return { size: matrix.size, path: qrSvgPath(matrix.modules) };
    } catch {
      return null;
    }
  }, [shareUrl]);

  const handleCopy = () => {
    if (!shareUrl) return;
    void navigator.clipboard
      .writeText(shareUrl)
      .then(() => {
        setCopied(true);
        if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
        copyTimer.current = window.setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => {});
  };

  const enabled = !!status?.enabled;
  const caption =
    activeTarget?.mode === 'tailscale'
      ? activeTarget.secure
        ? 'Scan anywhere (Tailscale HTTPS)'
        : 'Scan anywhere (Tailscale)'
      : 'Scan on your phone (same Wi-Fi)';

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      width={312}
      position="bottom-end"
      withArrow
      shadow="md"
      styles={{ dropdown: { maxWidth: 'calc(100vw - 24px)' } }}
    >
      <Popover.Target>
        <Tooltip label="Open on phone (Wi-Fi or Tailscale)" withArrow disabled={opened}>
          <button
            type="button"
            className={`icon-btn relative${opened ? ' is-on' : ''}`}
            aria-label="Open on phone (Wi-Fi or Tailscale)"
            aria-pressed={opened}
            onClick={handleTriggerClick}
          >
            <Smartphone className="w-3.5 h-3.5" />
            {enabled && (
              <span
                className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-ok"
                aria-hidden="true"
              />
            )}
          </button>
        </Tooltip>
      </Popover.Target>

      <Popover.Dropdown p={12}>
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Smartphone className="w-3.5 h-3.5 text-ink-2 shrink-0" />
              <span className="text-[12.5px] font-semibold text-ink truncate">Phone access</span>
              <span
                className={`text-[10.5px] font-medium px-1.5 py-0.5 rounded-full leading-none ${
                  enabled ? 'bg-emerald-500/15 text-emerald-500' : 'bg-s3 text-ink-3'
                }`}
              >
                {enabled ? 'On' : 'Off'}
              </span>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void (enabled ? disable() : enable())}
              className="text-[11.5px] font-medium text-ink-2 hover:text-ink px-2 py-0.5 rounded-md bg-s3 hover:bg-s3h border border-line cursor-pointer transition-colors disabled:opacity-50"
            >
              {enabled ? 'Turn off' : 'Turn on'}
            </button>
          </div>

          <div
            className="grid grid-cols-2 gap-1 p-0.5 rounded-md bg-s3 border border-line"
            role="tablist"
            aria-label="Phone access mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeMode === 'lan'}
              onClick={() => setSelectedMode('lan')}
              className={`inline-flex items-center justify-center gap-1.5 text-[11.5px] font-medium py-1 rounded transition-colors cursor-pointer ${
                activeMode === 'lan'
                  ? 'bg-surface text-ink shadow-xs'
                  : 'text-ink-3 hover:text-ink'
              }`}
            >
              <Wifi className="w-3 h-3" />
              <span>Wi-Fi</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeMode === 'tailscale'}
              onClick={() => setSelectedMode('tailscale')}
              className={`inline-flex items-center justify-center gap-1.5 text-[11.5px] font-medium py-1 rounded transition-colors cursor-pointer ${
                activeMode === 'tailscale'
                  ? 'bg-surface text-ink shadow-xs'
                  : 'text-ink-3 hover:text-ink'
              }`}
            >
              <Globe className="w-3 h-3" />
              <span>Tailscale</span>
              {status?.tailscale.httpsActive && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
              )}
            </button>
          </div>

          {error && (
            <div className="text-[11.5px] rounded-md px-2.5 py-1.5 bg-err-bg text-err-fg border border-err-bd">
              {error}
            </div>
          )}

          {busy && !enabled && (
            <div className="flex items-center justify-center gap-2 py-6 text-[12px] text-ink-3">
              <Loader size="xs" />
              <span>Starting phone access listener…</span>
            </div>
          )}

          {status && activeMode === 'tailscale' && (
            <TailscaleSetupCard
              status={status}
              busy={busy}
              onRefresh={() => void refresh()}
              onEnableHttps={() => void enableHttps()}
              onDisableHttps={() => void disableHttps()}
            />
          )}

          {status?.enabled && activeMode === 'lan' && status.addresses.length === 0 && (
            <p className="m-0 text-[12px] text-ink-3 py-3 text-center">
              No local Wi-Fi/Ethernet IPv4 address detected.
            </p>
          )}

          {status?.enabled && shareUrl && qr && (
            <>
              <div className="flex flex-col items-center gap-1.5 pt-0.5">
                <div
                  className="p-2.5 rounded-lg inline-flex mx-auto border border-line"
                  style={{ backgroundColor: '#ffffff' }}
                >
                  <svg
                    viewBox={`-${QR_QUIET_MODULES} -${QR_QUIET_MODULES} ${qr.size + QR_QUIET_MODULES * 2} ${qr.size + QR_QUIET_MODULES * 2}`}
                    width={168}
                    height={168}
                    role="img"
                    aria-label={`QR code for ${taskId}`}
                    shapeRendering="crispEdges"
                  >
                    <path d={qr.path} fill="#000000" />
                  </svg>
                </div>
                <p className="m-0 text-[11.5px] text-ink-3 text-center">
                  {caption} · opens <span className="font-mono text-ink-2">{taskId}</span>
                </p>
              </div>

              <div className="flex items-center gap-1.5 rounded-md bg-s3 border border-line px-2 py-1">
                <code className="text-[11px] font-mono text-ink-2 truncate flex-1 min-w-0 select-all">
                  {shareUrl}
                </code>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-surface hover:bg-s3h text-ink border border-line cursor-pointer transition-colors"
                  aria-label="Copy link"
                >
                  {copied ? (
                    <>
                      <Check className="w-3 h-3 text-ok" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>

              {modeTargets.length > 1 && (
                <div className="flex flex-wrap gap-1">
                  {modeTargets.map((target) => {
                    const selected = target.id === activeTarget?.id;
                    return (
                      <button
                        key={target.id}
                        type="button"
                        onClick={() => setSelectedTargetId(target.id)}
                        className={`text-[10.5px] font-mono px-1.5 py-0.5 rounded-full border cursor-pointer transition-colors ${
                          selected
                            ? 'bg-acc-bg text-acc-fg border-acc-bd'
                            : 'bg-s3 text-ink-3 border-line hover:text-ink'
                        }`}
                      >
                        {target.label}
                      </button>
                    );
                  })}
                </div>
              )}

              <p className="m-0 text-[10.5px] text-ink-3 leading-snug">
                Protected by a one-time link token. Turn off when done.
              </p>
            </>
          )}

          {status?.enabled && status.keepAwakeSupported && (
            <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-line">
              <div className="flex items-center gap-1.5 text-[11px] text-ink-2 min-w-0">
                <Moon className="w-3 h-3 text-ink-3 shrink-0" />
                <span className="truncate">Keep Mac awake</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={status.keepAwake}
                disabled={busy}
                onClick={() =>
                  void runAction(
                    () => api.setRemoteKeepAwake(!status.keepAwake),
                    'Could not update sleep setting'
                  )
                }
                className={`text-[10.5px] font-medium px-2 py-0.5 rounded-full border cursor-pointer transition-colors disabled:opacity-50 ${
                  status.keepAwake
                    ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
                    : 'bg-s3 text-ink-3 border-line hover:text-ink'
                }`}
              >
                {status.keepAwake ? 'On' : 'Off'}
              </button>
            </div>
          )}

          {status?.enabled && !status.servesUi && (
            <div className="text-[11px] rounded-md px-2 py-1.5 bg-wait-bg text-wait-fg border border-wait-bd leading-snug">
              Build the app (<code className="font-mono">npm run build</code>) or use the desktop app
              so your phone can load the UI.
            </div>
          )}

          {!enabled && !busy && !error && (
            <p className="m-0 text-[11.5px] text-ink-3">
              Turn on phone access to open this session over Wi-Fi or Tailscale.
            </p>
          )}
        </div>
      </Popover.Dropdown>
    </Popover>
  );
};
