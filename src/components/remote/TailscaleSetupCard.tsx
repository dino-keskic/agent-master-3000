import React from 'react';
import { ExternalLink, Lock, RefreshCw, ShieldCheck } from 'lucide-react';
import { RemoteAccessStatus } from '../../../shared/http/remoteAccess';

/**
 * Tailscale connection status, onboarding checklist, and one-click HTTPS Serve
 * toggle rendered inside the Tailscale tab of `RemoteAccessPopover`.
 */

interface TailscaleSetupCardProps {
  status: RemoteAccessStatus;
  busy: boolean;
  onRefresh: () => void;
  onEnableHttps: () => void;
  onDisableHttps: () => void;
}

export const TailscaleSetupCard: React.FC<TailscaleSetupCardProps> = ({
  status,
  busy,
  onRefresh,
  onEnableHttps,
  onDisableHttps
}) => {
  const ts = status.tailscale;

  if (!ts.installed && ts.state !== 'running') {
    return (
      <div className="rounded-md bg-s3 border border-line p-2.5 flex flex-col gap-2 text-[11.5px]">
        <div className="font-medium text-ink">Set up Tailscale for off-network access</div>
        <ol className="m-0 pl-4 text-ink-3 flex flex-col gap-1 leading-snug">
          <li>Install Tailscale on this Mac and on your phone.</li>
          <li>Sign in to the same Tailscale account on both devices.</li>
          <li>Optional: enable MagicDNS &amp; HTTPS certificates for Safari mic dictation.</li>
        </ol>
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <a
            href="https://tailscale.com/download"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-acc-fg hover:underline"
          >
            <span>Download Tailscale</span>
            <ExternalLink className="w-3 h-3" />
          </a>
          <button
            type="button"
            disabled={busy}
            onClick={onRefresh}
            className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-surface hover:bg-s3h text-ink border border-line cursor-pointer transition-colors disabled:opacity-50"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Refresh</span>
          </button>
        </div>
      </div>
    );
  }

  if (ts.state === 'stopped') {
    return (
      <div className="rounded-md bg-wait-bg border border-wait-bd p-2.5 flex flex-col gap-2 text-[11.5px]">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-wait-fg">
            Tailscale is installed ({ts.backendState ?? 'disconnected'})
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={onRefresh}
            className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-surface hover:bg-s3h text-ink border border-line cursor-pointer transition-colors disabled:opacity-50"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Refresh</span>
          </button>
        </div>
        <p className="m-0 text-wait-fg/90 leading-snug">
          Connect and sign in from the Tailscale menu bar app on this Mac, then click Refresh.
        </p>
      </div>
    );
  }

  if (ts.state === 'running' && ts.httpsActive) {
    return (
      <div className="rounded-md bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-2 flex items-center justify-between gap-2 text-[11px]">
        <div className="flex items-center gap-1.5 min-w-0 text-emerald-500 font-medium">
          <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Tailscale HTTPS active</span>
          {ts.httpsPort && ts.httpsPort !== 443 && (
            <span className="font-mono text-[10px] px-1 py-0.5 rounded bg-emerald-500/15">
              :{ts.httpsPort}
            </span>
          )}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onDisableHttps}
          className="shrink-0 text-[10.5px] font-medium text-ink-2 hover:text-ink px-1.5 py-0.5 rounded bg-surface border border-line cursor-pointer transition-colors disabled:opacity-50"
        >
          Disable HTTPS
        </button>
      </div>
    );
  }

  if (ts.state === 'running') {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="rounded-md bg-s3 border border-line px-2.5 py-2 flex items-center justify-between gap-2 text-[11px]">
          <div className="min-w-0 flex flex-col">
            <span className="font-medium text-ink truncate">
              {ts.dnsName ?? ts.tailnetName ?? 'Tailnet connected'}
            </span>
            {!ts.installed ? (
              <span className="text-[10.5px] text-ink-3">
                CLI not detected; using Tailnet IP (HTTP)
              </span>
            ) : !ts.dnsName ? (
              <span className="text-[10.5px] text-ink-3">
                Enable MagicDNS in Tailscale for HTTPS URLs
              </span>
            ) : (
              <span className="text-[10.5px] text-ink-3">
                HTTPS unlocks Safari mic &amp; PWA mode
              </span>
            )}
          </div>
          {ts.installed && ts.dnsName && (
            <button
              type="button"
              disabled={busy}
              onClick={onEnableHttps}
              className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded bg-acc-bg text-acc-fg border border-acc-bd cursor-pointer transition-colors disabled:opacity-50"
            >
              <Lock className="w-3 h-3" />
              <span>Enable HTTPS</span>
            </button>
          )}
        </div>

        {ts.serveError && (
          <div className="rounded-md bg-wait-bg border border-wait-bd px-2.5 py-1.5 text-[11px] text-wait-fg flex flex-col gap-1 leading-snug">
            <span>{ts.serveError}</span>
            {ts.serveActionUrl && (
              <a
                href={ts.serveActionUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium underline w-fit"
              >
                <span>Open Tailscale Admin</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}
      </div>
    );
  }

  return null;
};
