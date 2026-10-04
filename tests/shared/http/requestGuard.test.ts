import test from 'node:test';
import assert from 'node:assert';
import {
  allowedHostnames,
  bearerToken,
  checkRequest,
  cookieValue,
  isAllowedOrigin,
  isLoopbackBind,
  localBoardUrl,
  normalizeHostname,
  sameSecret,
  takeTokenParam,
  tokenLinkHandoff,
  tokenCookie
} from '../../../shared/http/requestGuard.js';

/**
 * The board's front door. Every case here is a request a web page could make
 * against a board on 127.0.0.1 — and the ones the board's own UI, its MCP
 * server and the Docker sandbox make, which must keep working.
 */

const LOCAL = { hosts: allowedHostnames(undefined, '127.0.0.1') };

test('hostnames are read out of Host headers, URLs and config entries alike', () => {
  assert.equal(normalizeHostname('127.0.0.1:3001'), '127.0.0.1');
  assert.equal(normalizeHostname('LOCALHOST:3999'), 'localhost');
  assert.equal(normalizeHostname('[::1]:3001'), '::1');
  assert.equal(normalizeHostname('::1'), '::1');
  assert.equal(normalizeHostname('http://box.lan:8080/path'), 'box.lan');
  assert.equal(normalizeHostname('localhost.'), 'localhost');
  assert.equal(normalizeHostname(''), undefined);
  assert.equal(normalizeHostname(undefined), undefined);
});

test('the allow-list is loopback, the configured names and a named bind', () => {
  assert.deepEqual(allowedHostnames(undefined, '127.0.0.1').sort(), ['127.0.0.1', '::1', 'localhost']);
  assert.ok(allowedHostnames(' devbox.lan , http://10.0.0.5:3999 ', undefined).includes('devbox.lan'));
  assert.ok(allowedHostnames('http://10.0.0.5:3999', undefined).includes('10.0.0.5'));
  assert.ok(allowedHostnames(undefined, 'board.internal').includes('board.internal'));
  // A wildcard bind names no host: it must not let every Host header through.
  assert.ok(!allowedHostnames(undefined, '0.0.0.0').includes('0.0.0.0'));
  assert.ok(!allowedHostnames(undefined, '::').includes('::'));
});

test("the board's own UI, MCP server and sandbox get through", () => {
  // The Vite proxy rewrites Host and forwards the page's Origin.
  assert.deepEqual(
    checkRequest({ host: '127.0.0.1:3001', origin: 'http://127.0.0.1:3999', fetchSite: 'same-origin' }, LOCAL),
    { ok: true }
  );
  // The socket upgrade is proxied without rewriting Host.
  assert.deepEqual(checkRequest({ host: 'localhost:3999', origin: 'http://localhost:3999' }, LOCAL), { ok: true });
  // The MCP server and curl send neither Origin nor Sec-Fetch-Site.
  assert.deepEqual(checkRequest({ host: '127.0.0.1:3001' }, LOCAL), { ok: true });
  // The sandbox publishes 4999/4001 on the host's loopback.
  assert.deepEqual(checkRequest({ host: '127.0.0.1:4001', origin: 'http://127.0.0.1:4999' }, LOCAL), { ok: true });
  assert.deepEqual(checkRequest({ host: '[::1]:3001', origin: 'http://[::1]:3999' }, LOCAL), { ok: true });
  // Typing the API URL into the address bar is a navigation nobody started.
  assert.deepEqual(checkRequest({ host: '127.0.0.1:3001', fetchSite: 'none' }, LOCAL), { ok: true });
});

test('a DNS-rebinding page is refused by its Host header', () => {
  const verdict = checkRequest({ host: 'attacker.example:3001', fetchSite: 'same-origin' }, LOCAL);
  assert.equal(verdict.ok, false);
  assert.equal(!verdict.ok && verdict.status, 403);
  assert.match(!verdict.ok ? verdict.reason : '', /BOARD_ALLOWED_HOSTS/);
});

test('a request with no Host at all is refused', () => {
  assert.equal(checkRequest({}, LOCAL).ok, false);
});

test('another site cannot drive the board or open its socket', () => {
  for (const origin of ['https://evil.example', 'http://127.0.0.1.evil.example', 'null', 'file://', 'chrome-extension://abc']) {
    const verdict = checkRequest({ host: '127.0.0.1:3001', origin }, LOCAL);
    assert.equal(verdict.ok, false, origin);
  }
});

test('an <img> or <script> GET from another site is refused although it carries no Origin', () => {
  const verdict = checkRequest({ host: '127.0.0.1:3001', fetchSite: 'cross-site' }, LOCAL);
  assert.equal(verdict.ok, false);
});

test('a configured name is accepted as Host and as Origin', () => {
  const hosts = allowedHostnames('devbox.lan', '0.0.0.0');
  assert.deepEqual(checkRequest({ host: 'devbox.lan:3001', origin: 'http://devbox.lan:3999' }, { hosts }), { ok: true });
  assert.equal(checkRequest({ host: 'other.lan:3001' }, { hosts }).ok, false);
});

test('*.localhost is loopback in every browser, so it is allowed', () => {
  assert.ok(isAllowedOrigin('http://board.localhost:3999', LOCAL.hosts));
  assert.ok(!isAllowedOrigin('http://localhost.evil.example', LOCAL.hosts));
});

test('a token, when set, is required from everyone', () => {
  const config = { ...LOCAL, token: 's3cret-token' };
  const base = { host: '127.0.0.1:3001' };
  const missing = checkRequest(base, config);
  assert.equal(missing.ok, false);
  assert.equal(!missing.ok && missing.status, 401);
  assert.equal(checkRequest({ ...base, authorization: 'Bearer wrong' }, config).ok, false);
  assert.equal(checkRequest({ ...base, cookie: 'agent_master_token=s3cret-toke' }, config).ok, false);
  assert.deepEqual(checkRequest({ ...base, authorization: 'Bearer s3cret-token' }, config), { ok: true });
  assert.deepEqual(checkRequest({ ...base, cookie: 'theme=dark; agent_master_token=s3cret-token' }, config), { ok: true });
  // The token does not stand in for the other checks.
  assert.equal(checkRequest({ host: 'evil.example', authorization: 'Bearer s3cret-token' }, config).ok, false);
});

test('bearer and cookie parsing', () => {
  assert.equal(bearerToken('Bearer abc'), 'abc');
  assert.equal(bearerToken('bearer   abc  '), 'abc');
  assert.equal(bearerToken('Basic abc'), undefined);
  assert.equal(bearerToken(undefined), undefined);
  assert.equal(cookieValue('a=1; agent_master_token=x%20y', 'agent_master_token'), 'x y');
  assert.equal(cookieValue('xagent_master_token=1', 'agent_master_token'), undefined);
  assert.equal(cookieValue(undefined, 'agent_master_token'), undefined);
});

test('secrets compare equal only when they are', () => {
  assert.ok(sameSecret('abc', 'abc'));
  assert.ok(!sameSecret('abd', 'abc'));
  assert.ok(!sameSecret('ab', 'abc'));
  assert.ok(!sameSecret('abcd', 'abc'));
  assert.ok(!sameSecret('', 'abc'));
});

test('loopback binds are told apart from exposed ones', () => {
  assert.ok(isLoopbackBind(undefined));
  assert.ok(isLoopbackBind('127.0.0.1'));
  assert.ok(isLoopbackBind('127.1.2.3'));
  assert.ok(isLoopbackBind('localhost'));
  assert.ok(isLoopbackBind('::1'));
  assert.ok(!isLoopbackBind('0.0.0.0'));
  assert.ok(!isLoopbackBind('::'));
  assert.ok(!isLoopbackBind('192.168.1.20'));
});

test('the MCP server reaches a wildcard-bound board on loopback, and a named one by its name', () => {
  assert.equal(localBoardUrl('0.0.0.0', '3001'), 'http://127.0.0.1:3001');
  assert.equal(localBoardUrl('::', 3001), 'http://127.0.0.1:3001');
  assert.equal(localBoardUrl('127.0.0.1', '3001'), 'http://127.0.0.1:3001');
  assert.equal(localBoardUrl('192.168.1.20', '3001'), 'http://192.168.1.20:3001');
  assert.equal(localBoardUrl('::1', '3001'), 'http://[::1]:3001');
});

test('a token link hands its token over and leaves the address bar', () => {
  assert.deepEqual(takeTokenParam('http://127.0.0.1:3999/?token=abc&task=TASK-1,TASK-2'), {
    token: 'abc',
    href: 'http://127.0.0.1:3999/?task=TASK-1,TASK-2'
  });
  assert.deepEqual(takeTokenParam('http://127.0.0.1:3999/?task=TASK-1'), {
    href: 'http://127.0.0.1:3999/?task=TASK-1'
  });
  assert.deepEqual(takeTokenParam('http://127.0.0.1:3999/?token='), { token: undefined, href: 'http://127.0.0.1:3999/' });
});

test('the token cookie never rides along on another site\'s request', () => {
  assert.equal(tokenCookie('a b', false), 'agent_master_token=a%20b; Path=/; Max-Age=31536000; SameSite=Strict');
  assert.match(tokenCookie('x', true), /; Secure$/);
});

test('a correct token link is answered with the cookie and the same page without it', () => {
  const config = { ...LOCAL, token: 'secret' };
  const link = { host: 'localhost:3737', method: 'GET', secure: false };
  assert.deepEqual(tokenLinkHandoff({ ...link, url: '/?token=secret&task=TASK-1,TASK-2' }, config), {
    cookie: tokenCookie('secret', false),
    location: '/?task=TASK-1,TASK-2'
  });
  assert.equal(tokenLinkHandoff({ ...link, url: '/?token=secret' }, config)?.location, '/');
  assert.match(tokenLinkHandoff({ ...link, url: '/?token=secret', secure: true }, config)?.cookie ?? '', /; Secure$/);
});

test('anything but a correct, same-site GET token link falls through to the guard', () => {
  const config = { ...LOCAL, token: 'secret' };
  const link = { host: 'localhost:3737', method: 'GET', secure: false, url: '/?token=secret' };
  assert.equal(tokenLinkHandoff({ ...link, url: '/?token=wrong' }, config), undefined);
  assert.equal(tokenLinkHandoff({ ...link, url: '/' }, config), undefined);
  assert.equal(tokenLinkHandoff({ ...link, method: 'POST' }, config), undefined);
  assert.equal(tokenLinkHandoff({ ...link, host: 'evil.example' }, config), undefined);
  assert.equal(tokenLinkHandoff({ ...link, fetchSite: 'cross-site' }, config), undefined);
  assert.equal(tokenLinkHandoff(link, LOCAL), undefined);
});
