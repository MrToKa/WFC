// @vitest-environment node
import type { Request, Response as ExpressResponse, Router } from 'express';
import http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), authenticate: vi.fn(), requireAdmin: vi.fn() }));
vi.mock('../db.js', () => ({ pool: { query: mocks.query } }));
vi.mock('../middleware.js', () => ({ authenticate: mocks.authenticate, requireAdmin: mocks.requireAdmin }));
import { createPreparerRouter, preparerCookie, preparerSettings, verifiedPreparerSetCookie, preparerHttpFetch } from './preparerRoutes.js';

const USER = '380e4cb8-32ea-4ae0-92fa-4011a5abe0a0', OTHER = '9b3065cb-5c12-4768-bd49-8319aa788239';
const PUBLIC = 'http://127.0.0.1:5193', INTERNAL = 'http://preparer:8090', CSRF = 'c'.repeat(43), COOKIE = 'preparer_session=' + 's'.repeat(43);
const SET_COOKIE = COOKIE + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800';
const env = { WFC_PREPARER_INTERNAL_ORIGIN: INTERNAL, WFC_PREPARER_PUBLIC_ORIGIN: PUBLIC };
type Handler = (req: Request, res: ExpressResponse) => Promise<void>;
type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: Handler }[] } };
function route(router: Router, method: string) { const value = (router as unknown as { stack: Layer[] }).stack.find(layer => layer.route?.path === '/session' && layer.route.methods[method])?.route; if (!value) throw Error('route missing'); return value; }
const responseStub = () => { const value = { status: vi.fn(), json: vi.fn(), setHeader: vi.fn() }; value.status.mockReturnValue(value); return value as unknown as ExpressResponse; };
const request = (changes: Partial<Request> = {}) => ({ userId: USER, isAdmin: true, headers: { cookie: 'unrelated=PRIVATE_OTHER; ' + COOKIE }, body: {}, header: (name: string) => name === 'authorization' ? 'Bearer PRIVATE_WFC_TOKEN' : undefined, ...changes }) as Request;
const json = (body: unknown, options: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...options });
function fixture(settings = env) {
  const fetcher = vi.fn<typeof fetch>(), currentAdmin = vi.fn().mockResolvedValue(true);
  fetcher.mockResolvedValueOnce(json({ authenticated: false, csrfToken: CSRF })).mockResolvedValueOnce(json({ user: { id: USER, isAdmin: true }, expiresAt: 'fixture' }, { headers: { 'Set-Cookie': SET_COOKIE } }));
  const router = createPreparerRouter({ fetch: fetcher, env: settings, currentAdmin });
  return { fetcher, currentAdmin, router, run: (req = request(), response = responseStub()) => ({ response, done: route(router, 'post').stack.at(-1)!.handle(req, response) }) };
}
afterEach(() => vi.restoreAllMocks());

describe('fixed admin preparer gateway', () => {
  it('hands off to a shared internal and public LAN origin on port 8083', async () => {
    const origin = 'http://192.168.5.55:8083';
    const settings = { WFC_PREPARER_INTERNAL_ORIGIN: origin, WFC_PREPARER_PUBLIC_ORIGIN: origin };
    expect(preparerSettings(settings)).toEqual({ internalOrigin: origin, publicOrigin: origin });
    const f = fixture(settings), action = f.run(); await action.done;
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(f.fetcher.mock.calls[0]).toEqual([origin + '/api/session', expect.objectContaining({ headers: expect.objectContaining({ Origin: origin, Host: '192.168.5.55:8083' }) })]);
    expect(f.fetcher.mock.calls[1]).toEqual([origin + '/api/session/handoff', expect.objectContaining({ body: JSON.stringify({ token: 'PRIVATE_WFC_TOKEN' }), headers: expect.objectContaining({ Origin: origin, Host: '192.168.5.55:8083', 'X-Preparer-CSRF': CSRF }) })]);
    expect(action.response.setHeader).toHaveBeenCalledWith('Set-Cookie', SET_COOKIE);
    expect(action.response.json).toHaveBeenCalledWith({ url: origin });
  });
  it('attaches authenticate and current requireAdmin only to handoff, keeps authenticated logout available', () => {
    const { router } = fixture(); expect(route(router, 'post').stack.map(item => item.handle).slice(0, 2)).toEqual([mocks.authenticate, mocks.requireAdmin]); expect(route(router, 'delete').stack[0].handle).toBe(mocks.authenticate); expect(route(router, 'delete').stack).toHaveLength(2);
  });
  it('obtains exact public Host/Origin challenge, forwards one cookie, and sends token only in internal handoff', async () => {
    const f = fixture(), action = f.run(); await action.done;
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(f.fetcher.mock.calls[0]).toEqual([INTERNAL + '/api/session', expect.objectContaining({ method: 'GET', redirect: 'manual', cache: 'no-store', headers: { Accept: 'application/json', Origin: PUBLIC, Host: '127.0.0.1:5193', Cookie: COOKIE } })]);
    expect(f.fetcher.mock.calls[1]).toEqual([INTERNAL + '/api/session/handoff', expect.objectContaining({ method: 'POST', redirect: 'manual', body: JSON.stringify({ token: 'PRIVATE_WFC_TOKEN' }), headers: expect.objectContaining({ 'X-Preparer-CSRF': CSRF, Origin: PUBLIC, Host: '127.0.0.1:5193', Cookie: COOKIE }) })]);
    expect(f.currentAdmin).toHaveBeenCalledWith(USER); expect(action.response.setHeader).toHaveBeenCalledWith('Set-Cookie', SET_COOKIE); expect(action.response.json).toHaveBeenCalledWith({ url: PUBLIC }); expect(JSON.stringify(vi.mocked(action.response.json).mock.calls)).not.toMatch(/PRIVATE|token|cookie|csrf/i);
  });
  it.each([false, undefined])('refuses a nonadministrator handler even with a stale role label', async isAdmin => {
    const f = fixture(), action = f.run(request({ isAdmin, role: 'admin' })); await action.done; expect(action.response.status).toHaveBeenCalledWith(403); expect(f.fetcher).not.toHaveBeenCalled();
  });
  it.each([null, [], { token: 'caller-token' }, { clientId: 'APS_KEY' }, { url: 'http://127.0.0.1:5191' }])('refuses caller-controlled forwarding fields: %j', async body => {
    const f = fixture(), action = f.run(request({ body })); await action.done; expect(action.response.status).toHaveBeenCalledWith(400); expect(f.fetcher).not.toHaveBeenCalled();
  });
  it('rechecks current administrator after awaits and refuses copying a cookie following demotion', async () => {
    const f = fixture(); f.currentAdmin.mockResolvedValue(false); const action = f.run(); await action.done; expect(action.response.status).toHaveBeenCalledWith(403); expect(action.response.setHeader).not.toHaveBeenCalled();
  });
  it('rejects a forged handoff owner or nonadmin reply without copying cookie', async () => {
    for (const user of [{ id: OTHER, isAdmin: true }, { id: USER, isAdmin: false }]) {
      const f = fixture(); f.fetcher.mockReset().mockResolvedValueOnce(json({ authenticated: false, csrfToken: CSRF })).mockResolvedValueOnce(json({ user }, { headers: { 'Set-Cookie': SET_COOKIE } }));
      const action = f.run(); await action.done; expect(action.response.status).toHaveBeenCalledWith(503); expect(action.response.setHeader).not.toHaveBeenCalled();
    }
  });
  it('does not follow an upstream redirect or expose a foreign error body', async () => {
    const f = fixture(); f.fetcher.mockReset().mockResolvedValueOnce(json({ error: 'PRIVATE_UPSTREAM_SECRET' }, { status: 302, headers: { Location: 'https://foreign.example' } }));
    const action = f.run(); await action.done; expect(f.fetcher).toHaveBeenCalledTimes(1); expect(action.response.status).toHaveBeenCalledWith(503); expect(JSON.stringify(vi.mocked(action.response.json).mock.calls)).not.toMatch(/PRIVATE|foreign\.example/);
  });
  it('rejects missing nonce and overlarge challenge responses before token forwarding', async () => {
    for (const response of [json({ authenticated: false }), new Response('x'.repeat(32769))]) {
      const f = fixture(); f.fetcher.mockReset().mockResolvedValueOnce(response); const action = f.run(); await action.done; expect(f.fetcher).toHaveBeenCalledTimes(1); expect(action.response.status).toHaveBeenCalledWith(503);
    }
  });
  it('fails disabled configuration with an actionable message and no request', async () => {
    const fetcher = vi.fn<typeof fetch>(), router = createPreparerRouter({ env: {}, fetch: fetcher }), response = responseStub(); await route(router, 'post').stack.at(-1)!.handle(request(), response);
    expect(response.status).toHaveBeenCalledWith(503); expect(response.json).toHaveBeenCalledWith({ error: expect.stringContaining('not configured') }); expect(fetcher).not.toHaveBeenCalled();
  });
  it('always clears local logout cookie; upstream revoke is limited to the same owner', async () => {
    for (const matched of [true, false]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ authenticated: true, user: { id: matched ? USER : OTHER, isAdmin: true }, csrfToken: CSRF })).mockResolvedValueOnce(json({ ok: true }));
      const router = createPreparerRouter({ env, fetch: fetcher }), response = responseStub(); await route(router, 'delete').stack.at(-1)!.handle(request({ isAdmin: false }), response);
      expect(fetcher).toHaveBeenCalledTimes(matched ? 2 : 1); expect(response.setHeader).toHaveBeenCalledWith('Set-Cookie', 'preparer_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'); expect(response.json).toHaveBeenCalledWith({ revoked: matched });
    }
  });
  it('offline upstream cannot prevent local logout', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(Error('PRIVATE_CONNECTION_ERROR')), router = createPreparerRouter({ env, fetch: fetcher }), response = responseStub(); await route(router, 'delete').stack.at(-1)!.handle(request(), response);
    expect(response.json).toHaveBeenCalledWith({ revoked: false }); expect(response.setHeader).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('Max-Age=0'));
  });
});
describe('origin and cookie boundaries', () => {
  it.each(['http://user:password@192.168.5.55:8083', 'http://192.168.5.55:8083/path', 'http://192.168.5.55:8083/', 'http://192.168.5.55:8083?token=secret', 'http://192.168.5.55:8083#fragment', 'ftp://192.168.5.55:8083'])('refuses malformed port 8083 origins for either endpoint: %s', value => {
    expect(() => preparerSettings({ ...env, WFC_PREPARER_PUBLIC_ORIGIN: value })).toThrow();
    expect(() => preparerSettings({ ...env, WFC_PREPARER_INTERNAL_ORIGIN: value })).toThrow();
  });
  it.each(['http://127.0.0.1:5191', 'http://127.0.0.1:5192', 'http://a:b@127.0.0.1:5193', PUBLIC + '/path', PUBLIC + '/', PUBLIC + '?token=secret', PUBLIC + '#fragment', 'javascript:alert(1)'])('refuses unexpected public target %s', value => expect(() => preparerSettings({ ...env, WFC_PREPARER_PUBLIC_ORIGIN: value })).toThrow());
  it('forwards no unrelated cookie and refuses duplicated or malformed session cookies', () => {
    expect(preparerCookie('other=PRIVATE; ' + COOKIE)).toBe(COOKIE); expect(preparerCookie('other=PRIVATE')).toBeUndefined();
    for (const cookie of [COOKIE + '; ' + COOKIE, 'preparer_session=short', 'preparer_session=' + 's'.repeat(44), COOKIE + '\r\nAuthorization: PRIVATE']) expect(() => preparerCookie(cookie)).toThrow();
  });
  it('rejects cookies with weaker attributes, extra scope, expired capability or multiple values', () => {
    for (const value of [SET_COOKIE.replace('HttpOnly', 'Domain=127.0.0.1'), SET_COOKIE.replace('Strict', 'Lax'), SET_COOKIE.replace('Path=/', 'Path=/preparer'), SET_COOKIE.replace('28800', '0'), SET_COOKIE + '; Domain=127.0.0.1', SET_COOKIE + ', unrelated=secret']) expect(() => verifiedPreparerSetCookie(new Headers({ 'Set-Cookie': value }), PUBLIC)).toThrow();
    expect(verifiedPreparerSetCookie(new Headers({ 'Set-Cookie': SET_COOKIE + '; Secure' }), 'https://preparer.example.test:5193')).toBe(SET_COOKIE + '; Secure');
  });
  it('native transport sends the exact Host on the socket and never follows a redirect', async () => {
    const received: string[] = [], server = http.createServer((req, res) => { received.push(req.headers.host ?? ''); res.writeHead(302, { Location: '/never-follow', 'Set-Cookie': SET_COOKIE }); res.end('{}'); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try { const address = server.address(); if (!address || typeof address === 'string') throw Error('missing test address'); const response = await preparerHttpFetch('http://127.0.0.1:' + address.port, { headers: { Host: '127.0.0.1:5193' }, signal: AbortSignal.timeout(2000) }); expect(response.status).toBe(302); expect(received).toEqual(['127.0.0.1:5193']); expect(response.headers.get('set-cookie')).toBe(SET_COOKIE); }
    finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});
