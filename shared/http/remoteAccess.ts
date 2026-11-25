/**
 * Pure helpers for local-network (LAN) remote access: ranking network
 * interfaces, building the request guard's host allow-list, and formatting
 * deep links with a session target and token.
 *
 * Kept free of `os` and `http` so the ranking and URL rules can be tested
 * directly and shared between the server controller and the client popover.
 */

import { normalizeHostname, TOKEN_PARAM } from './requestGuard.js';
import { SESSION_PARAM, TASK_PARAM } from '../board/deepLink.js';
import { isTailscaleIpv4, TailscaleStatus } from './tailscale.js';

export interface LanInterface {
  name: string;
  address: string;
  family: string | number;
  internal: boolean;
}

export interface RemoteAccessStatus {
  enabled: boolean;
  port?: number;
  token?: string;
  /** Best non-internal LAN IPv4 addresses, ranked (Wi-Fi/Ethernet RFC1918 first). */
  addresses: string[];
  /** Optional mDNS hostname (e.g. 'macbook.local'). */
  mdnsHost?: string;
  /** True when the LAN server can serve the built UI directly. */
  servesUi: boolean;
  /** Live Tailscale daemon status, serve state, and Tailnet endpoints. */
  tailscale: TailscaleStatus;
  /** True while macOS idle-sleep prevention is active. */
  keepAwake: boolean;
  /** True when the host platform supports idle-sleep prevention. */
  keepAwakeSupported: boolean;
}

/** Primary Wi-Fi and Ethernet interface names across macOS and Linux. */
const PREFERRED_INTERFACE = /^(en0|en1|wlan0|eth0)$/i;

/** Apple peer-to-peer link-local interfaces that phones cannot browse over LAN. */
const APPLE_P2P_INTERFACE = /^(awdl|llw)/i;

/** Virtual, container, bridge, or tunnel interfaces ranked behind physical NICs. */
const VIRTUAL_INTERFACE = /^(bridge|utun|docker|veth|lo|virbr|vboxnet|vmnet|br-|wg|tun|tap)/i;

function parseIpv4(address: string): [number, number, number, number] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    nums.push(n);
  }
  return [nums[0]!, nums[1]!, nums[2]!, nums[3]!];
}

function isPrivateRfc1918([a, b]: [number, number, number, number]): boolean {
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function interfaceRank(name: string, octets: [number, number, number, number]): number {
  const rfc1918 = isPrivateRfc1918(octets);
  const virtual = VIRTUAL_INTERFACE.test(name);
  if (!virtual && PREFERRED_INTERFACE.test(name) && rfc1918) return 0;
  if (!virtual && rfc1918) return 1;
  if (!virtual) return 2;
  if (rfc1918) return 3;
  return 4;
}

/**
 * Picks non-internal IPv4 addresses reachable on the LAN and sorts them with
 * physical Wi-Fi/Ethernet RFC1918 addresses first and virtual/tunnel bridges last.
 */
export function selectLanAddresses(interfaces: readonly LanInterface[]): string[] {
  const candidates: Array<{ address: string; name: string; rank: number }> = [];

  for (const iface of interfaces) {
    if (iface.internal) continue;
    if (iface.family !== 'IPv4' && iface.family !== 4) continue;
    if (APPLE_P2P_INTERFACE.test(iface.name)) continue;

    const address = iface.address.trim();
    const octets = parseIpv4(address);
    if (!octets) continue;
    // Exclude loopback (127.0.0.0/8), link-local (169.254.0.0/16), unspecified (0.0.0.0),
    // and Tailscale CGNAT (100.64.0.0/10, surfaced separately in Tailscale targets).
    if (octets[0] === 127 || octets[0] === 0) continue;
    if (octets[0] === 169 && octets[1] === 254) continue;
    if (isTailscaleIpv4(address)) continue;

    candidates.push({ address, name: iface.name, rank: interfaceRank(iface.name, octets) });
  }

  candidates.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return byName;
    return a.address.localeCompare(b.address);
  });

  const seen = new Set<string>();
  const ranked: string[] = [];
  for (const item of candidates) {
    if (seen.has(item.address)) continue;
    seen.add(item.address);
    ranked.push(item.address);
  }
  return ranked;
}

/** Picks the first non-internal Tailscale CGNAT IPv4 (`100.64.0.0/10`) as an interface fallback. */
export function selectTailscaleFallbackIp(interfaces: readonly LanInterface[]): string | undefined {
  for (const iface of interfaces) {
    if (iface.internal) continue;
    if (iface.family !== 'IPv4' && iface.family !== 4) continue;
    if (APPLE_P2P_INTERFACE.test(iface.name)) continue;
    const address = iface.address.trim();
    if (isTailscaleIpv4(address)) return address;
  }
  return undefined;
}

/**
 * Normalizes LAN IP addresses, an optional mDNS hostname, and extra hosts
 * (such as Tailscale DNS names/IPs) for the request guard's `Host`/`Origin` allow-list.
 */
export function lanAllowedHosts(
  addresses: readonly string[],
  mdnsHost?: string,
  extraHosts: readonly string[] = []
): string[] {
  const hosts = new Set<string>();
  for (const entry of addresses) {
    const normalized = normalizeHostname(entry);
    if (normalized) hosts.add(normalized);
  }
  const mdns = normalizeHostname(mdnsHost);
  if (mdns) hosts.add(mdns);
  for (const extra of extraHosts) {
    const normalized = normalizeHostname(extra);
    if (normalized) hosts.add(normalized);
  }
  return [...hosts];
}

export interface RemoteSessionUrlOptions {
  host: string;
  protocol?: 'http' | 'https';
  port?: number;
  token?: string;
  taskId?: string;
  sessionId?: string;
}

/**
 * Builds the scannable LAN or Tailscale URL that hands over the token cookie
 * and opens the requested task and session directly.
 */
export function remoteSessionUrl(opts: RemoteSessionUrlOptions): string {
  const protocol = opts.protocol ?? 'http';
  const trimmedHost = opts.host.trim();
  const formattedHost =
    trimmedHost.includes(':') && !trimmedHost.startsWith('[') ? `[${trimmedHost}]` : trimmedHost;
  const defaultPort = protocol === 'https' ? 443 : 80;
  const portSuffix = opts.port !== undefined && opts.port !== defaultPort ? `:${opts.port}` : '';
  const url = new URL(`${protocol}://${formattedHost}${portSuffix}/`);
  if (opts.token?.trim()) url.searchParams.set(TOKEN_PARAM, opts.token.trim());
  if (opts.taskId?.trim()) url.searchParams.set(TASK_PARAM, opts.taskId.trim());
  if (opts.sessionId?.trim()) url.searchParams.set(SESSION_PARAM, opts.sessionId.trim());
  return url.toString();
}

export type RemoteAccessMode = 'lan' | 'tailscale';

export interface RemoteAccessTarget {
  id: string;
  mode: RemoteAccessMode;
  label: string;
  host: string;
  protocol: 'http' | 'https';
  port: number;
  secure: boolean;
}

/** Builds ordered target links for the Tailscale and Wi-Fi modes when remote access is enabled. */
export function buildRemoteAccessTargets(status: RemoteAccessStatus | null): RemoteAccessTarget[] {
  if (!status?.enabled || !status.port) return [];
  const targets: RemoteAccessTarget[] = [];

  if (status.tailscale.httpsActive && status.tailscale.dnsName && status.tailscale.httpsPort) {
    const httpsPort = status.tailscale.httpsPort;
    targets.push({
      id: 'ts-https',
      mode: 'tailscale',
      label:
        httpsPort === 443
          ? `${status.tailscale.dnsName} (HTTPS)`
          : `${status.tailscale.dnsName}:${httpsPort} (HTTPS)`,
      host: status.tailscale.dnsName,
      protocol: 'https',
      port: httpsPort,
      secure: true
    });
  }

  if (status.tailscale.state === 'running' && status.tailscale.dnsName) {
    targets.push({
      id: 'ts-dns',
      mode: 'tailscale',
      label: `${status.tailscale.dnsName} (HTTP)`,
      host: status.tailscale.dnsName,
      protocol: 'http',
      port: status.port,
      secure: false
    });
  }

  for (const ip of status.tailscale.ips) {
    if (!isTailscaleIpv4(ip)) continue;
    targets.push({
      id: `ts-ip:${ip}`,
      mode: 'tailscale',
      label: ip,
      host: ip,
      protocol: 'http',
      port: status.port,
      secure: false
    });
  }

  for (const address of status.addresses) {
    targets.push({
      id: `lan:${address}`,
      mode: 'lan',
      label: address,
      host: address,
      protocol: 'http',
      port: status.port,
      secure: false
    });
  }

  if (status.mdnsHost) {
    targets.push({
      id: `lan:${status.mdnsHost}`,
      mode: 'lan',
      label: status.mdnsHost,
      host: status.mdnsHost,
      protocol: 'http',
      port: status.port,
      secure: false
    });
  }

  return targets;
}

/** Picks which tab to open initially based on whether Tailscale HTTPS or only Tailscale is active. */
export function defaultRemoteAccessMode(status: RemoteAccessStatus | null): RemoteAccessMode {
  if (status?.tailscale.httpsActive) return 'tailscale';
  if (
    status &&
    status.addresses.length === 0 &&
    status.tailscale.state === 'running' &&
    (status.tailscale.dnsName || status.tailscale.ips.length > 0)
  ) {
    return 'tailscale';
  }
  return 'lan';
}
