/**
 * Who the board's API and live socket will answer.
 *
 * The server can start agents that run shell commands, and it listens on a
 * port every web page the user opens can send requests to. So each request is
 * judged on what a browser cannot forge:
 *
 * - `Host` must be a name the board answers to. A DNS-rebinding page reaches
 *   127.0.0.1 under its own hostname, and this is the one header that says so.
 * - `Origin`, when a browser sends one, must be one of those names too — a
 *   page elsewhere cannot drive the board, and cannot open its socket.
 * - `Sec-Fetch-Site: cross-site` is refused outright. It is the only mark an
 *   `<img>` or `<script>` GET from another site carries, since those send no
 *   Origin at all.
 * - With a token configured, every request must present it — as a bearer
 *   header (the board's MCP server) or the cookie a `?token=` link sets.
 *
 * A client that is not a browser can say whatever it likes in these headers;
 * the loopback bind is what keeps those out, and the token is what is left
 * when the bind is opened up. All of it is pure so it can be tested here;
 * `server/http/requestGuard.ts` feeds it the headers.
 */

/** Always allowed: the names that can only mean this machine. */
export const LOOPBACK_HOSTNAMES = ['localhost', '127.0.0.1', '::1'] as const;

/** Where the UI keeps the token once `?token=` has handed it over. */
export const TOKEN_COOKIE = 'agent_master_token';

/** The query parameter a token link carries. */
export const TOKEN_PARAM = 'token';

/** Binds that mean "every interface" rather than a name anyone connects to. */
const WILDCARD_BINDS = new Set(['', '0.0.0.0', '::', '[::]']);

export interface RequestGuardConfig {
  /** Hostnames the board answers to: lower case, no port, IPv6 without brackets. */
  hosts: string[];
  /** When set, every request has to carry it. */
  token?: string;
}

/** The headers a verdict is made from. Every one of them may be missing. */
export interface GuardInput {
  host?: string;
  origin?: string;
  fetchSite?: string;
  authorization?: string;
  cookie?: string;
}

export type GuardVerdict = { ok: true } | { ok: false; status: 401 | 403; reason: string };

/**
 * The bare hostname in a `Host` header, a URL or a configured entry:
 * `LOCALHOST:3001` → `localhost`, `[::1]:3001` → `::1`, `http://box.lan` → `box.lan`.
 */
export function normalizeHostname(raw: string | undefined): string | undefined {
  let value = (raw || '').trim().toLowerCase();
  if (!value) return undefined;
  if (value.includes('://')) {
    try {
      value = new URL(value).host;
    } catch {
      return undefined;
    }
  }
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end > 1 ? value.slice(1, end) : undefined;
  }
  // More than one colon and no brackets: a bare IPv6 address, which has no port.
  if (value.indexOf(':') !== value.lastIndexOf(':')) return value;
  const hostname = value.split(':')[0]!.replace(/\.$/, '');
  return hostname || undefined;
}

/**
 * Loopback, plus whatever `BOARD_ALLOWED_HOSTS` lists (comma separated), plus
 * the address the server was told to bind to — unless that is a wildcard,
 * which names no host.
 */
export function allowedHostnames(extra: string | undefined, bindHost: string | undefined): string[] {
  const hosts = new Set<string>(LOOPBACK_HOSTNAMES);
  for (const entry of (extra || '').split(',')) {
    const hostname = normalizeHostname(entry);
    if (hostname) hosts.add(hostname);
  }
  const bind = (bindHost || '').trim().toLowerCase();
  if (!WILDCARD_BINDS.has(bind)) {
    const hostname = normalizeHostname(bind);
    if (hostname) hosts.add(hostname);
  }
  return [...hosts];
}

/** `*.localhost` resolves to loopback in every browser (RFC 6761), so it is loopback too. */
export function isAllowedHostname(hostname: string | undefined, hosts: string[]): boolean {
  if (!hostname) return false;
  return hosts.includes(hostname) || hostname.endsWith('.localhost');
}

/** An `Origin` header naming one of the allowed hosts, over http(s). `null` never is. */
export function isAllowedOrigin(origin: string, hosts: string[]): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return isAllowedHostname(normalizeHostname(url.host), hosts);
}

/** Whether a bind address keeps the board to this machine. */
export function isLoopbackBind(bindHost: string | undefined): boolean {
  const hostname = normalizeHostname(bindHost || '127.0.0.1');
  if (!hostname) return false;
  return hostname === 'localhost' || hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

/**
 * The URL a process on this machine reaches the board at. A wildcard bind is
 * reachable on loopback, and loopback is always in the allow-list; a named
 * bind is the only address the server listens on, so it has to be that one.
 */
export function localBoardUrl(bindHost: string | undefined, port: string | number): string {
  const bind = (bindHost || '').trim();
  let host = WILDCARD_BINDS.has(bind.toLowerCase()) ? '127.0.0.1' : bind;
  if (host.includes(':') && !host.startsWith('[')) host = `[${host}]`;
  return `http://${host}:${port}`;
}

/** A cookie's value out of a `Cookie` header, decoded. */
export function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

/** `Authorization: Bearer <token>` → `<token>`. */
export function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header || '');
  return match ? match[1] : undefined;
}

/**
 * Equal strings, compared without stopping at the first difference, so the
 * time a wrong guess takes says nothing about how much of it was right.
 */
export function sameSecret(presented: string, expected: string): boolean {
  let diff = presented.length ^ expected.length;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= (presented.charCodeAt(i) || 0) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/** The verdict on one request, HTTP or socket upgrade alike. */
export function checkRequest(input: GuardInput, config: RequestGuardConfig): GuardVerdict {
  const hostname = normalizeHostname(input.host);
  if (!isAllowedHostname(hostname, config.hosts)) {
    return {
      ok: false,
      status: 403,
      reason: `Agent Master 3000 does not answer to host "${hostname || ''}". Add it to BOARD_ALLOWED_HOSTS to reach the board by that name.`
    };
  }
  if (input.origin && !isAllowedOrigin(input.origin, config.hosts)) {
    return { ok: false, status: 403, reason: `Blocked: Agent Master 3000 does not accept requests from ${input.origin}` };
  }
  if (input.fetchSite?.toLowerCase() === 'cross-site') {
    return { ok: false, status: 403, reason: 'Blocked: Agent Master 3000 does not accept cross-site requests' };
  }
  if (config.token) {
    const presented = bearerToken(input.authorization) ?? cookieValue(input.cookie, TOKEN_COOKIE);
    if (!presented || !sameSecret(presented, config.token)) {
      return {
        ok: false,
        status: 401,
        reason: `This board needs its token: open the UI once with ?${TOKEN_PARAM}=<BOARD_TOKEN>`
      };
    }
  }
  return { ok: true };
}

/**
 * The cookie the UI stores a token link's token in. `SameSite=Strict` keeps it
 * off every request another site starts; a year is "until the token changes".
 */
export function tokenCookie(token: string, secure: boolean): string {
  const attributes = ['Path=/', 'Max-Age=31536000', 'SameSite=Strict'];
  if (secure) attributes.push('Secure');
  return [`${TOKEN_COOKIE}=${encodeURIComponent(token)}`, ...attributes].join('; ');
}

/**
 * The token a location carries, and the same location without it — so the
 * secret leaves the address bar (and the history) as soon as it is read.
 */
export function takeTokenParam(href: string): { token?: string; href: string } {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { href };
  }
  if (!url.searchParams.has(TOKEN_PARAM)) return { href };
  const token = url.searchParams.get(TOKEN_PARAM)?.trim();
  url.searchParams.delete(TOKEN_PARAM);
  // The `?task=A,B` deep link spells its commas out; keep it that way.
  url.search = url.searchParams.toString().replace(/%2C/gi, ',');
  return { token: token || undefined, href: url.toString() };
}

/**
 * What to answer a page load that carries a correct `?token=`: set the cookie
 * and redirect to the same address without it. The page's own script cannot
 * do this alone — with a token configured the guard refuses the page itself,
 * so the script that would store the cookie is never sent. Everything else the
 * guard checks still applies; a wrong token gets no handoff, and the request
 * falls through to the ordinary 401.
 */
export function tokenLinkHandoff(
  input: GuardInput & { method?: string; url: string; secure: boolean },
  config: RequestGuardConfig
): { cookie: string; location: string } | undefined {
  if (!config.token || input.method?.toUpperCase() !== 'GET') return undefined;
  // Only the path and query matter here; the base just makes it parseable.
  const { token, href } = takeTokenParam(new URL(input.url, 'http://board.invalid').toString());
  if (!token || !sameSecret(token, config.token)) return undefined;
  if (!checkRequest({ ...input, authorization: `Bearer ${token}` }, config).ok) return undefined;

  const clean = new URL(href);
  return { cookie: tokenCookie(token, input.secure), location: `${clean.pathname}${clean.search}` };
}
