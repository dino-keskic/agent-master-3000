/**
 * Pure Tailscale CLI output parsing, serve port selection, URL construction,
 * and error hint helpers shared by the server and client.
 */

import { normalizeHostname } from './requestGuard.js';

export type TailscaleStateKind = 'unavailable' | 'stopped' | 'running';

export interface TailscaleStatus {
  installed: boolean;
  state: TailscaleStateKind;
  /** Raw `BackendState` reported by `tailscale status --json` (e.g. `Running`, `NeedsLogin`). */
  backendState?: string;
  /** Normalized MagicDNS FQDN without trailing dot (e.g. `macbook.tail1234.ts.net`). */
  dnsName?: string;
  tailnetName?: string;
  /** Tailscale IPs, sorted with IPv4 (`100.64.0.0/10`) before IPv6. */
  ips: string[];
  certDomains: string[];
  httpsActive: boolean;
  httpsPort?: number;
  httpsUrl?: string;
  serveError?: string;
  serveActionUrl?: string;
}

export const SERVE_CANDIDATE_PORTS = [443, 8443, 9443, 10443] as const;

const KNOWN_STOPPED_STATES = new Set([
  'Stopped',
  'NeedsLogin',
  'NeedsMachineAuth',
  'NoState',
  'Starting'
]);

/**
 * Returns `true` when `ip` is a valid IPv4 address inside Tailscale's
 * RFC 6598 CGNAT range (`100.64.0.0/10`).
 */
export function isTailscaleIpv4(ip: string): boolean {
  const trimmed = ip.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 4) return false;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false;
    if (part.length > 1 && part.startsWith('0')) return false;
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) return false;
    octets.push(value);
  }
  const [o0, o1] = octets;
  return o0 === 100 && o1 !== undefined && o1 >= 64 && o1 <= 127;
}

/**
 * Normalizes a MagicDNS hostname or cert domain by trimming, stripping
 * trailing dots, and lowercasing. Rejects values containing invalid separators.
 */
export function normalizeTailscaleDnsName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.trim().replace(/\.+$/, '').toLowerCase();
  if (!cleaned) return undefined;
  if (/[\s/\\:?#@]/.test(cleaned)) return undefined;
  if (cleaned.startsWith('.')) return undefined;
  return cleaned;
}

interface RawTailscaleStatusJson {
  BackendState?: unknown;
  Self?: {
    DNSName?: unknown;
    TailscaleIPs?: unknown;
  } | null;
  CertDomains?: unknown;
  CurrentTailnet?: {
    MagicDNSSuffix?: unknown;
    Name?: unknown;
  } | null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function parseTailscaleState(backendState: string | undefined): TailscaleStateKind {
  if (!backendState) return 'unavailable';
  if (backendState === 'Running') return 'running';
  if (KNOWN_STOPPED_STATES.has(backendState)) return 'stopped';
  return 'stopped';
}

function dedupeTailscaleIps(rawIps: readonly string[]): string[] {
  const ipv4: string[] = [];
  const other: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawIps) {
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    if (isTailscaleIpv4(trimmed)) {
      ipv4.push(trimmed);
    } else {
      other.push(trimmed);
    }
  }
  return [...ipv4, ...other];
}

/** Parses `tailscale status --json` output into a normalized `TailscaleStatus`. */
export function parseTailscaleStatusJson(raw: string): TailscaleStatus {
  const fallback: TailscaleStatus = {
    installed: true,
    state: 'unavailable',
    ips: [],
    certDomains: [],
    httpsActive: false
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fallback;
  }

  const data = parsed as RawTailscaleStatusJson;
  const backendState =
    typeof data.BackendState === 'string' && data.BackendState.trim()
      ? data.BackendState.trim()
      : undefined;
  const state = parseTailscaleState(backendState);

  const dnsName =
    typeof data.Self?.DNSName === 'string'
      ? normalizeTailscaleDnsName(data.Self.DNSName)
      : undefined;

  const tailnetSuffix =
    typeof data.CurrentTailnet?.MagicDNSSuffix === 'string'
      ? normalizeTailscaleDnsName(data.CurrentTailnet.MagicDNSSuffix)
      : undefined;
  const tailnetLabel =
    typeof data.CurrentTailnet?.Name === 'string' && data.CurrentTailnet.Name.trim()
      ? data.CurrentTailnet.Name.trim()
      : undefined;
  const tailnetName = tailnetSuffix ?? tailnetLabel;

  const ips = dedupeTailscaleIps(asStringArray(data.Self?.TailscaleIPs));

  const certSet = new Set<string>();
  for (const rawDomain of asStringArray(data.CertDomains)) {
    const normalized = normalizeTailscaleDnsName(rawDomain);
    if (normalized) certSet.add(normalized);
  }

  return {
    installed: true,
    state,
    backendState,
    dnsName,
    tailnetName,
    ips,
    certDomains: [...certSet],
    httpsActive: false
  };
}

function addValidPort(target: Set<number>, rawPort: string): void {
  if (!/^\d+$/.test(rawPort)) return;
  const port = Number(rawPort);
  if (Number.isInteger(port) && port >= 1 && port <= 65535) {
    target.add(port);
  }
}

/** Parses `tailscale serve status --json` to find TCP/Web HTTPS ports already in use. */
export function parseServeOccupiedPorts(raw: string): number[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return [];
  }

  const record = parsed as { TCP?: unknown; Web?: unknown };
  const ports = new Set<number>();

  if (record.TCP && typeof record.TCP === 'object' && !Array.isArray(record.TCP)) {
    for (const key of Object.keys(record.TCP)) {
      addValidPort(ports, key.trim());
    }
  }

  if (record.Web && typeof record.Web === 'object' && !Array.isArray(record.Web)) {
    for (const key of Object.keys(record.Web)) {
      const match = /:(\d+)$/.exec(key.trim());
      if (match?.[1]) addValidPort(ports, match[1]);
    }
  }

  return [...ports].sort((a, b) => a - b);
}

/** Picks the first free port from `SERVE_CANDIDATE_PORTS`, or `undefined` if all are taken. */
export function pickServeHttpsPort(occupiedPorts: readonly number[]): number | undefined {
  const occupied = new Set(occupiedPorts);
  return SERVE_CANDIDATE_PORTS.find((port) => !occupied.has(port));
}

/** Builds the HTTPS URL served by `tailscale serve` for a MagicDNS hostname and port. */
export function tailscaleServeUrl(dnsName: string, httpsPort: number): string {
  const host =
    normalizeTailscaleDnsName(dnsName) ?? dnsName.trim().replace(/\.+$/, '').toLowerCase();
  return httpsPort === 443 ? `https://${host}` : `https://${host}:${httpsPort}`;
}

/** Collects normalized `Host` / `Origin` allow-list entries from a `TailscaleStatus`. */
export function tailscaleAllowedHosts(ts: TailscaleStatus): string[] {
  const hosts = new Set<string>();
  const candidates = [ts.dnsName, ...ts.ips, ...ts.certDomains];
  for (const candidate of candidates) {
    const normalized = normalizeHostname(candidate);
    if (normalized) hosts.add(normalized);
  }
  return [...hosts];
}

const TAILSCALE_URL_RE = /https:\/\/(?:login\.)?tailscale\.com\/[^\s"'<>)]+/i;

/** Turns noisy `tailscale serve` stderr/stdout into a concise hint and optional Admin action URL. */
export function parseServeErrorHint(output: string): { message: string; actionUrl?: string } {
  const urlMatch = TAILSCALE_URL_RE.exec(output);
  const actionUrl = urlMatch?.[0].replace(/[.,);'"]+$/, '');

  if (/serve is not enabled/i.test(output)) {
    return {
      message: 'Enable Tailscale Serve for your tailnet, then retry HTTPS.',
      actionUrl
    };
  }

  if (/(https|certificate|magicdns|enable https)/i.test(output)) {
    return {
      message: 'Enable MagicDNS and HTTPS Certificates in Tailscale Admin -> DNS, then retry.',
      actionUrl: actionUrl ?? 'https://login.tailscale.com/admin/dns'
    };
  }

  const firstLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstLine) {
    const compact = firstLine.replace(/\s+/g, ' ');
    const message = compact.length > 200 ? `${compact.slice(0, 197)}...` : compact;
    return { message, actionUrl };
  }

  return { message: 'Could not start Tailscale HTTPS serve.', actionUrl };
}
