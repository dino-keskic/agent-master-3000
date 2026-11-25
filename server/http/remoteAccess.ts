import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import type { AddressInfo, Socket } from 'net';
import os from 'os';
import path from 'path';
import type { Express } from 'express';
import { WebSocketServer } from 'ws';
import {
  lanAllowedHosts,
  LanInterface,
  RemoteAccessStatus,
  selectLanAddresses,
  selectTailscaleFallbackIp
} from '../../shared/http/remoteAccess.js';
import { tailscaleAllowedHosts, TailscaleStatus } from '../../shared/http/tailscale.js';
import { LiveHub } from '../live/hub.js';
import { createKeepAwakeHandle, KeepAwakeHandle } from './keepAwake.js';
import { boardToken, setRemoteAccessGuard, verifySocketClient } from './requestGuard.js';
import { createTailscaleClient, TailscaleClient, TailscaleServeError } from './tailscale.js';

/**
 * Optional secondary HTTP + WebSocket listener bound on `0.0.0.0` for phone
 * access over local Wi-Fi or Tailscale, without disturbing the primary
 * loopback listener (`127.0.0.1`) used by the desktop app and MCP.
 *
 * Every socket accepted on this listener is tracked in a `WeakSet` and routed
 * through `setRemoteAccessGuard`, requiring a session token while optionally
 * managing `tailscale serve` HTTPS termination and macOS idle-sleep prevention.
 */

export interface RemoteAccessOptions {
  app: Express;
  hub: LiveHub;
  mainPort: number;
  clientDir: string;
  isBundled: boolean;
  tailscale?: TailscaleClient;
  keepAwake?: KeepAwakeHandle;
  collectInterfaces?: () => LanInterface[];
  detectMdnsHost?: () => string | undefined;
}

interface ActiveListener {
  server: http.Server;
  wss: WebSocketServer;
  port: number;
  token: string;
  remoteSockets: WeakSet<Socket>;
  tailscaleServePort?: number;
  tailscaleServeUrl?: string;
  tailscaleServeError?: string;
  tailscaleServeActionUrl?: string;
}

function collectInterfaces(): LanInterface[] {
  const result: LanInterface[] = [];
  const table = os.networkInterfaces();
  for (const [name, entries] of Object.entries(table)) {
    if (!entries) continue;
    for (const entry of entries) {
      result.push({
        name,
        address: entry.address,
        family: entry.family,
        internal: entry.internal
      });
    }
  }
  return result;
}

function detectMdnsHost(): string | undefined {
  const raw = os.hostname().trim().replace(/\.local$/i, '');
  if (!raw || raw.toLowerCase() === 'localhost') return undefined;
  return `${raw}.local`;
}

function listenOn(server: http.Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      const addr = server.address() as AddressInfo | null;
      if (!addr) return reject(new Error('LAN listener bound without an address'));
      resolve(addr.port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

async function bindLanServer(server: http.Server, preferredPort: number): Promise<number> {
  if (preferredPort > 0) {
    try {
      return await listenOn(server, preferredPort, '0.0.0.0');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE' && code !== 'EACCES') throw err;
    }
  }
  return listenOn(server, 0, '0.0.0.0');
}

export class RemoteAccessController {
  private active: ActiveListener | null = null;
  private enabling: Promise<RemoteAccessStatus> | null = null;
  private keepAwakeDesired = true;
  private lastTailscale: TailscaleStatus = {
    installed: false,
    state: 'unavailable',
    ips: [],
    certDomains: [],
    httpsActive: false
  };
  private readonly tailscale: TailscaleClient;
  private readonly keepAwake: KeepAwakeHandle;
  private readonly readInterfaces: () => LanInterface[];
  private readonly readMdnsHost: () => string | undefined;

  constructor(private readonly opts: RemoteAccessOptions) {
    this.tailscale = opts.tailscale ?? createTailscaleClient();
    this.keepAwake = opts.keepAwake ?? createKeepAwakeHandle();
    this.readInterfaces = opts.collectInterfaces ?? collectInterfaces;
    this.readMdnsHost = opts.detectMdnsHost ?? detectMdnsHost;
  }

  servesUi(): boolean {
    return this.opts.isBundled || fs.existsSync(path.join(this.opts.clientDir, 'index.html'));
  }

  private effectiveTailscale(interfaces: LanInterface[]): TailscaleStatus {
    const fallbackIp =
      this.lastTailscale.ips.length === 0 ? selectTailscaleFallbackIp(interfaces) : undefined;
    const ips = fallbackIp ? [fallbackIp] : [...this.lastTailscale.ips];
    const state =
      this.lastTailscale.state === 'unavailable' && fallbackIp ? 'running' : this.lastTailscale.state;

    return {
      ...this.lastTailscale,
      state,
      ips,
      certDomains: [...this.lastTailscale.certDomains],
      httpsActive: this.active?.tailscaleServePort !== undefined,
      httpsPort: this.active?.tailscaleServePort,
      httpsUrl: this.active?.tailscaleServeUrl,
      serveError: this.active?.tailscaleServeError,
      serveActionUrl: this.active?.tailscaleServeActionUrl
    };
  }

  private syncGuardOverlay(interfaces?: LanInterface[]): void {
    const active = this.active;
    if (!active) return;
    const ifaces = interfaces ?? this.readInterfaces();
    const addresses = selectLanAddresses(ifaces);
    const mdnsHost = this.readMdnsHost();
    const ts = this.effectiveTailscale(ifaces);
    setRemoteAccessGuard({
      hosts: lanAllowedHosts(addresses, mdnsHost, tailscaleAllowedHosts(ts)),
      token: active.token,
      isRemoteSocket: (socket) => !!socket && active.remoteSockets.has(socket as Socket),
      trustLoopbackProxy: active.tailscaleServePort !== undefined
    });
  }

  status(): RemoteAccessStatus {
    const ifaces = this.readInterfaces();
    const addresses = selectLanAddresses(ifaces);
    const mdnsHost = this.readMdnsHost();
    const tailscale = this.effectiveTailscale(ifaces);
    if (!this.active) {
      return {
        enabled: false,
        addresses,
        mdnsHost,
        servesUi: this.servesUi(),
        tailscale,
        keepAwake: this.keepAwake.isActive(),
        keepAwakeSupported: this.keepAwake.supported
      };
    }
    return {
      enabled: true,
      port: this.active.port,
      token: this.active.token,
      addresses,
      mdnsHost,
      servesUi: this.servesUi(),
      tailscale,
      keepAwake: this.keepAwake.isActive(),
      keepAwakeSupported: this.keepAwake.supported
    };
  }

  private async probeTailscaleSafely(): Promise<TailscaleStatus> {
    try {
      this.lastTailscale = await this.tailscale.probe();
    } catch {
      // Keep prior cached Tailscale status if probing fails unexpectedly.
    }
    return this.lastTailscale;
  }

  async refreshStatus(): Promise<RemoteAccessStatus> {
    await this.probeTailscaleSafely();
    this.syncGuardOverlay();
    return this.status();
  }

  async enable(): Promise<RemoteAccessStatus> {
    if (this.active) return this.refreshStatus();
    if (this.enabling) return this.enabling;

    this.enabling = this.startListener().finally(() => {
      this.enabling = null;
    });
    return this.enabling;
  }

  private async startTailscaleServeOnActive(active: ActiveListener, dnsName: string): Promise<void> {
    active.tailscaleServeError = undefined;
    active.tailscaleServeActionUrl = undefined;
    try {
      const res = await this.tailscale.startServe(active.port, dnsName);
      if (this.active !== active) {
        await this.tailscale.stopServe(res.httpsPort).catch(() => {});
        return;
      }
      active.tailscaleServePort = res.httpsPort;
      active.tailscaleServeUrl = res.url;
      this.syncGuardOverlay();
      console.log(
        `[RemoteAccess] Tailscale HTTPS serve active at ${res.url} -> http://127.0.0.1:${active.port}`
      );
    } catch (err) {
      if (this.active !== active) return;
      active.tailscaleServeError =
        err instanceof Error ? err.message : 'Could not start Tailscale HTTPS serve.';
      active.tailscaleServeActionUrl =
        err instanceof TailscaleServeError ? err.actionUrl : undefined;
    }
  }

  private async startListener(): Promise<RemoteAccessStatus> {
    const token = boardToken() || crypto.randomBytes(18).toString('base64url');
    const remoteSockets = new WeakSet<Socket>();
    const lanServer = http.createServer(this.opts.app);
    lanServer.on('connection', (socket) => {
      remoteSockets.add(socket);
    });

    const preferredPort = this.opts.mainPort > 0 ? this.opts.mainPort + 1 : 0;
    let port: number;
    try {
      port = await bindLanServer(lanServer, preferredPort);
    } catch (err) {
      try { lanServer.close(); } catch { /* ignore */ }
      throw err;
    }

    lanServer.on('error', (err) => {
      console.warn('[RemoteAccess] LAN server error:', err.message);
    });

    // Attach WebSocketServer only after the HTTP server has bound so port-retry
    // errors never bubble through ws as unhandled 'error' events.
    const lanWss = new WebSocketServer({
      server: lanServer,
      path: '/ws',
      maxPayload: 64 * 1024,
      verifyClient: verifySocketClient
    });
    this.opts.hub.listen(lanWss);

    const active: ActiveListener = {
      server: lanServer,
      wss: lanWss,
      port,
      token,
      remoteSockets
    };

    const ts = await this.probeTailscaleSafely();
    this.active = active;
    this.syncGuardOverlay();

    if (this.keepAwakeDesired && this.keepAwake.supported) {
      this.keepAwake.start();
    }

    console.log(`[RemoteAccess] LAN listener active on http://0.0.0.0:${port}`);

    if (ts.installed && ts.state === 'running' && ts.dnsName && ts.certDomains.length > 0) {
      await this.startTailscaleServeOnActive(active, ts.dnsName);
    }

    return this.status();
  }

  async enableTailscaleHttps(): Promise<RemoteAccessStatus> {
    if (!this.active) {
      await this.enable();
    }
    const active = this.active;
    if (!active) return this.status();
    if (active.tailscaleServePort !== undefined) {
      return this.refreshStatus();
    }

    const ts = await this.probeTailscaleSafely();
    this.syncGuardOverlay();
    if (this.active !== active) return this.status();

    if (!ts.installed) {
      active.tailscaleServeError = 'Install the Tailscale CLI/app on this Mac to enable HTTPS.';
      active.tailscaleServeActionUrl = 'https://tailscale.com/download';
      return this.status();
    }

    if (ts.state !== 'running' || !ts.dnsName) {
      active.tailscaleServeError =
        'Connect this Mac to Tailscale with MagicDNS enabled, then retry.';
      active.tailscaleServeActionUrl = 'https://login.tailscale.com/admin/dns';
      return this.status();
    }

    await this.startTailscaleServeOnActive(active, ts.dnsName);
    return this.status();
  }

  async disableTailscaleHttps(): Promise<RemoteAccessStatus> {
    const active = this.active;
    if (active?.tailscaleServePort !== undefined) {
      const port = active.tailscaleServePort;
      active.tailscaleServePort = undefined;
      active.tailscaleServeUrl = undefined;
      active.tailscaleServeError = undefined;
      active.tailscaleServeActionUrl = undefined;
      this.syncGuardOverlay();
      await this.tailscale.stopServe(port).catch(() => {});
    } else if (active) {
      active.tailscaleServeError = undefined;
      active.tailscaleServeActionUrl = undefined;
    }
    return this.status();
  }

  setKeepAwake(enabled: boolean): RemoteAccessStatus {
    this.keepAwakeDesired = enabled;
    if (this.active && this.keepAwake.supported) {
      if (enabled) {
        this.keepAwake.start();
      } else {
        this.keepAwake.stop();
      }
    }
    return this.status();
  }

  private teardownListener(): number | undefined {
    setRemoteAccessGuard(null);
    this.keepAwake.stop();
    if (!this.active) return undefined;

    const { server, wss, tailscaleServePort } = this.active;
    this.active = null;
    for (const client of wss.clients) {
      try { client.terminate(); } catch { /* ignore */ }
    }
    try { wss.close(); } catch { /* ignore */ }
    try { server.close(); } catch { /* ignore */ }
    // Drop keep-alive phone sockets immediately instead of waiting for idle timeout.
    try { server.closeAllConnections(); } catch { /* ignore */ }
    console.log('[RemoteAccess] LAN listener stopped');
    return tailscaleServePort;
  }

  disable(): RemoteAccessStatus {
    const servePort = this.teardownListener();
    if (servePort !== undefined) {
      this.tailscale.stopServeSync(servePort);
    }
    return this.status();
  }

  async disableAsync(): Promise<RemoteAccessStatus> {
    const servePort = this.teardownListener();
    if (servePort !== undefined) {
      await this.tailscale.stopServe(servePort).catch(() => {});
    }
    return this.status();
  }
}
