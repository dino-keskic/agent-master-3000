import type { IncomingMessage } from 'http';
import type { NextFunction, Request, Response } from 'express';
import {
  allowedHostnames,
  checkRequest,
  GuardVerdict,
  isAllowedOrigin,
  isLoopbackBind,
  RequestGuardConfig,
  tokenLinkHandoff
} from '../../shared/http/requestGuard.js';

/**
 * The server side of `shared/http/requestGuard.ts`: the config comes from the
 * environment once, and the same verdict guards every HTTP route and the
 * socket upgrade.
 */

/** The address the server binds to. Loopback unless told otherwise. */
export const BIND_HOST = process.env.HOST || '127.0.0.1';

/** Set it to require a token from every client; see the README. */
const BOARD_TOKEN = process.env.BOARD_TOKEN?.trim() || undefined;

export const guardConfig: RequestGuardConfig = {
  hosts: allowedHostnames(process.env.BOARD_ALLOWED_HOSTS, BIND_HOST),
  token: BOARD_TOKEN
};

/** The token the board's own MCP server presents, when there is one. */
export function boardToken(): string | undefined {
  return guardConfig.token;
}

function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function guardInput(req: IncomingMessage) {
  return {
    host: header(req.headers.host),
    origin: header(req.headers.origin),
    fetchSite: header(req.headers['sec-fetch-site']),
    authorization: header(req.headers.authorization),
    cookie: header(req.headers.cookie)
  };
}

function verdictFor(req: IncomingMessage): GuardVerdict {
  return checkRequest(guardInput(req), guardConfig);
}

/**
 * First middleware on the app: a token link is turned into the cookie here,
 * and anything else `checkRequest` refuses is answered as JSON.
 */
export function requestGuard(req: Request, res: Response, next: NextFunction): void {
  const handoff = tokenLinkHandoff(
    { ...guardInput(req), method: req.method, url: req.originalUrl, secure: req.secure },
    guardConfig
  );
  if (handoff) {
    res.setHeader('Set-Cookie', handoff.cookie);
    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(302, handoff.location);
  }

  const verdict = verdictFor(req);
  if (verdict.ok) return next();
  res.status(verdict.status).json({ error: verdict.reason });
}

/** CORS for the origins the guard lets through — never `*`. */
export function corsOrigin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void): void {
  if (!origin || isAllowedOrigin(origin, guardConfig.hosts)) return callback(null, true);
  callback(new Error('Blocked by CORS: Agent Master 3000 only accepts its own origins'));
}

/** `ws`'s `verifyClient`: a browser always sends Origin on an upgrade, so this is the socket's CSRF check. */
export function verifySocketClient(
  info: { req: IncomingMessage },
  callback: (ok: boolean, code?: number, message?: string) => void
): void {
  const verdict = verdictFor(info.req);
  if (verdict.ok) return callback(true);
  console.warn(`[Server] Refused a live socket: ${verdict.reason}`);
  callback(false, verdict.status, verdict.status === 401 ? 'Unauthorized' : 'Forbidden');
}

/** Said once at start-up, loudly, when the board can be reached from off this machine. */
export function warnIfExposed(): void {
  if (isLoopbackBind(BIND_HOST)) return;
  const lines = [
    '',
    '================================================================',
    ` WARNING: Agent Master 3000 is listening on ${BIND_HOST}, not loopback.`,
    ' Anyone who can reach this port can drive agents that run shell',
    ' commands on this machine.',
    guardConfig.token
      ? ' BOARD_TOKEN is set: every request must carry it. It travels in'
      : ' BOARD_TOKEN is NOT set: nothing but the network stands in the way.',
    guardConfig.token
      ? ' plain text over HTTP, so only use this on a network you trust.'
      : ' Set BOARD_TOKEN, or bind HOST=127.0.0.1 and tunnel in.',
    ` Hosts answered: ${guardConfig.hosts.join(', ')} (BOARD_ALLOWED_HOSTS adds more).`,
    '================================================================',
    ''
  ];
  console.warn(lines.join('\n'));
}
