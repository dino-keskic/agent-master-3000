/**
 * Tailscale CLI integration for probing Tailnet state and managing an HTTPS
 * `tailscale serve` reverse proxy bound strictly to the local secondary
 * remote-access listener.
 */

import { execFile, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
  parseServeErrorHint,
  parseServeOccupiedPorts,
  parseTailscaleStatusJson,
  pickServeHttpsPort,
  tailscaleServeUrl,
  TailscaleStatus
} from '../../shared/http/tailscale.js';

export class TailscaleServeError extends Error {
  readonly actionUrl?: string;

  constructor(message: string, actionUrl?: string) {
    super(message);
    this.name = 'TailscaleServeError';
    this.actionUrl = actionUrl;
  }
}

export interface TailscaleServeResult {
  httpsPort: number;
  url: string;
}

export interface TailscaleClient {
  probe(): Promise<TailscaleStatus>;
  startServe(targetPort: number, dnsName: string): Promise<TailscaleServeResult>;
  stopServe(httpsPort: number): Promise<void>;
  stopServeSync(httpsPort: number): void;
}

const WELL_KNOWN_BINARIES = [
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  '/opt/homebrew/bin/tailscale',
  '/usr/local/bin/tailscale',
  '/usr/bin/tailscale',
  '/usr/sbin/tailscale'
];

function isExecutableFile(candidate: string): boolean {
  try {
    const stat = fs.statSync(candidate);
    if (!stat.isFile()) return false;
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Finds an executable `tailscale` binary via `TAILSCALE_BIN`, `PATH`, or macOS/Linux defaults. */
export function resolveTailscaleBinary(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const explicit = env.TAILSCALE_BIN?.trim();
  if (explicit && isExecutableFile(explicit)) return explicit;

  const pathEntries = (env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of pathEntries) {
    const candidate = path.join(dir, 'tailscale');
    if (isExecutableFile(candidate)) return candidate;
  }

  for (const candidate of WELL_KNOWN_BINARIES) {
    if (isExecutableFile(candidate)) return candidate;
  }

  return undefined;
}

interface ExecTextResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function execText(bin: string, args: readonly string[], timeoutMs: number): Promise<ExecTextResult> {
  return new Promise((resolve) => {
    execFile(
      bin,
      [...args],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          stdout: typeof stdout === 'string' ? stdout : '',
          stderr: typeof stderr === 'string' ? stderr : ''
        });
      }
    );
  });
}

function notInstalledStatus(): TailscaleStatus {
  return {
    installed: false,
    state: 'unavailable',
    ips: [],
    certDomains: [],
    httpsActive: false
  };
}

/** Builds a CLI-backed `TailscaleClient` for probing status and managing `tailscale serve`. */
export function createTailscaleClient(): TailscaleClient {
  return {
    async probe(): Promise<TailscaleStatus> {
      const bin = resolveTailscaleBinary();
      if (!bin) return notInstalledStatus();

      const res = await execText(bin, ['status', '--json'], 4000);
      // `tailscale status --json` frequently exits non-zero when Stopped or NeedsLogin
      // while still emitting structured status JSON on stdout.
      const trimmed = res.stdout.trim();
      if (trimmed.startsWith('{')) {
        return parseTailscaleStatusJson(trimmed);
      }
      return {
        installed: true,
        state: 'stopped',
        ips: [],
        certDomains: [],
        httpsActive: false
      };
    },

    async startServe(targetPort: number, dnsName: string): Promise<TailscaleServeResult> {
      const bin = resolveTailscaleBinary();
      if (!bin) {
        throw new TailscaleServeError('Tailscale CLI is not installed on this machine.');
      }

      const statusRes = await execText(bin, ['serve', 'status', '--json'], 3000);
      const occupied = statusRes.stdout.trim() ? parseServeOccupiedPorts(statusRes.stdout) : [];
      const httpsPort = pickServeHttpsPort(occupied);
      if (!httpsPort) {
        throw new TailscaleServeError(
          'Tailscale HTTPS ports (443, 8443, 9443, 10443) are all occupied by other services.'
        );
      }

      // Proxy only the local token-guarded remote-access listener — never mainPort and never Funnel.
      const serveRes = await execText(
        bin,
        ['serve', '--bg', `--https=${httpsPort}`, `http://127.0.0.1:${targetPort}`],
        15000
      );
      if (!serveRes.ok) {
        const hint = parseServeErrorHint(`${serveRes.stderr}\n${serveRes.stdout}`);
        throw new TailscaleServeError(hint.message, hint.actionUrl);
      }

      return {
        httpsPort,
        url: tailscaleServeUrl(dnsName, httpsPort)
      };
    },

    async stopServe(httpsPort: number): Promise<void> {
      const bin = resolveTailscaleBinary();
      if (!bin) return;
      // Remove only the HTTPS serve listener we created; never run `tailscale serve reset`.
      await execText(bin, ['serve', `--https=${httpsPort}`, 'off'], 4000);
    },

    stopServeSync(httpsPort: number): void {
      const bin = resolveTailscaleBinary();
      if (!bin) return;
      try {
        execFileSync(bin, ['serve', `--https=${httpsPort}`, 'off'], {
          timeout: 2500,
          stdio: 'ignore',
          windowsHide: true
        });
      } catch {
        // Ignore shutdown cleanup errors.
      }
    }
  };
}
