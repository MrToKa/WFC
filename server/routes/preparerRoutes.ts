import { Router, type Request, type Response as ExpressResponse } from 'express';
import { pool } from '../db.js';
import { authenticate, requireAdmin } from '../middleware.js';
import http from 'node:http';
import https from 'node:https';

const COOKIE_NAME = 'preparer_session';
const MAX_RESPONSE_BYTES = 32 * 1024;
type Settings = { internalOrigin: string; publicOrigin: string };
type Dependencies = { fetch?: typeof fetch; env?: NodeJS.ProcessEnv; currentAdmin?: (userId: string) => Promise<boolean> };
class PreparerGatewayError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const unavailable = () => new PreparerGatewayError(503, 'The model preparer could not be reached. Try again when the service is available.');
const invalidBody = () => new PreparerGatewayError(400, 'The preparer request must contain an empty object.');
const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
function origin(value: string | undefined): string {
  if (!value) throw new PreparerGatewayError(503, 'The model preparer is not configured. Ask an administrator to finish its setup.');
  let parsed: URL; try { parsed = new URL(value); } catch { throw unavailable(); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.origin !== value) throw unavailable();
  return parsed.origin;
}
export function preparerSettings(env: NodeJS.ProcessEnv): Settings {
  const internalOrigin = origin(env.WFC_PREPARER_INTERNAL_ORIGIN), publicOrigin = origin(env.WFC_PREPARER_PUBLIC_ORIGIN);
  if (new URL(publicOrigin).port !== '5193' || internalOrigin === publicOrigin) throw unavailable();
  return { internalOrigin, publicOrigin };
}
export function preparerCookie(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  if (header.length > 8192 || /[\r\n]/.test(header)) throw new PreparerGatewayError(400, 'The preparer session cookie is invalid.');
  const matches = header.split(';').map(value => value.trim()).filter(value => value.split('=')[0] === COOKIE_NAME);
  if (!matches.length) return undefined;
  if (matches.length !== 1 || !/^preparer_session=[A-Za-z0-9_-]{43}$/.test(matches[0])) throw new PreparerGatewayError(400, 'The preparer session cookie is invalid.');
  return matches[0];
}
export function verifiedPreparerSetCookie(headers: Headers, publicOrigin: string): string {
  const values = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [headers.get('set-cookie')].filter((value): value is string => value !== null);
  if (values.length !== 1 || values[0].length > 300 || /[,\r\n]/.test(values[0])) throw unavailable();
  const [cookie, ...attributes] = values[0].split(';').map(value => value.trim());
  if (!/^preparer_session=[A-Za-z0-9_-]{43}$/.test(cookie)) throw unavailable();
  const secure = new URL(publicOrigin).protocol === 'https:', required = ['Path=/', 'HttpOnly', 'SameSite=Strict'];
  const maxAge = attributes.filter(value => /^Max-Age=/.test(value));
  if (attributes.length !== (secure ? 5 : 4) || required.some(value => attributes.filter(item => item === value).length !== 1)
    || maxAge.length !== 1 || !/^Max-Age=[1-9][0-9]{0,4}$/.test(maxAge[0]) || Number(maxAge[0].slice(8)) > 28800
    || attributes.includes('Secure') !== secure || attributes.some(value => !required.includes(value) && value !== maxAge[0] && value !== 'Secure')) throw unavailable();
  return values[0];
}
async function boundedJson(response: globalThis.Response): Promise<Record<string, unknown>> {
  if (response.status !== 200) throw unavailable();
  const reader = response.body?.getReader(); if (!reader) throw unavailable();
  const chunks: Uint8Array[] = []; let bytes = 0;
  try { for (;;) { const row = await reader.read(); if (row.done) break; bytes += row.value.byteLength; if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); throw unavailable(); } chunks.push(row.value); } }
  finally { reader.releaseLock(); }
  try { const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!plain(value)) throw unavailable(); return value; } catch { throw unavailable(); }
}
function clearCookie(res: ExpressResponse, settings?: Settings): void { res.setHeader('Set-Cookie', 'preparer_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' + (settings?.publicOrigin.startsWith('https:') ? '; Secure' : '')); }
const currentAdminDefault = async (userId: string): Promise<boolean> => (await pool.query<{ is_admin: boolean }>('SELECT is_admin FROM users WHERE id = $1', [userId])).rows[0]?.is_admin === true;

/** Native transport preserves the explicitly pinned Host header. Never follows redirects. */
export const preparerHttpFetch: typeof fetch = async (input, init = {}) => {
  if (typeof input !== 'string' && !(input instanceof URL)) throw unavailable();
  const target = new URL(input), body = init.body;
  if (!['http:', 'https:'].includes(target.protocol) || body !== undefined && typeof body !== 'string' || typeof body === 'string' && Buffer.byteLength(body) > 32768) throw unavailable();
  return new Promise<globalThis.Response>((resolve, reject) => {
    const headers = Object.fromEntries(new Headers(init.headers));
    if (typeof body === 'string') headers['content-length'] = String(Buffer.byteLength(body));
    const request = (target.protocol === 'https:' ? https : http).request(target, { method: init.method ?? 'GET', headers, timeout: 15000, signal: init.signal ?? undefined }, response => {
      const chunks: Buffer[] = []; let bytes = 0;
      response.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > MAX_RESPONSE_BYTES) { response.destroy(); request.destroy(); reject(unavailable()); } else chunks.push(chunk); });
      response.once('error', () => reject(unavailable()));
      response.once('aborted', () => reject(unavailable()));
      response.once('end', () => {
        if (!response.complete) { reject(unavailable()); return; }
        try {
          const received = new Headers(); for (let index = 0; index < response.rawHeaders.length; index += 2) received.append(response.rawHeaders[index], response.rawHeaders[index + 1]);
          resolve(new globalThis.Response(new Uint8Array(Buffer.concat(chunks)), { status: response.statusCode ?? 502, headers: received }));
        } catch { reject(unavailable()); }
      });
    });
    request.once('timeout', () => request.destroy()); request.once('error', () => reject(unavailable())); request.end(body);
  });
};

export function createPreparerRouter({ fetch: fetchImpl = preparerHttpFetch, env = process.env, currentAdmin = currentAdminDefault }: Dependencies = {}): Router {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Pragma', 'no-cache'); next(); });
  async function upstream(settings: Settings, endpoint: string, cookie: string | undefined, method: 'GET' | 'POST', input?: Record<string, unknown>, csrf?: string) {
    const headers: Record<string, string> = { Accept: 'application/json', Origin: settings.publicOrigin, Host: new URL(settings.publicOrigin).host };
    if (cookie) headers.Cookie = cookie;
    if (method === 'POST') { headers['Content-Type'] = 'application/json'; headers['X-Preparer-CSRF'] = csrf!; }
    return fetchImpl(settings.internalOrigin + endpoint, { method, headers, ...(input ? { body: JSON.stringify(input) } : {}), redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(5000) });
  }
  async function challenge(settings: Settings, cookie?: string) {
    const body = await boundedJson(await upstream(settings, '/api/session', cookie, 'GET'));
    if (typeof body.csrfToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.csrfToken) || typeof body.authenticated !== 'boolean') throw unavailable();
    return body as Record<string, unknown> & { csrfToken: string; authenticated: boolean };
  }
  router.post('/session', authenticate, requireAdmin, async (req: Request, res: ExpressResponse): Promise<void> => {
    try {
      if (!plain(req.body) || Object.keys(req.body).length) throw invalidBody();
      if (!req.userId || req.isAdmin !== true) throw new PreparerGatewayError(403, 'A current WFC administrator account is required.');
      const token = /^Bearer\s+(\S+)$/i.exec((req.header('authorization') ?? '').trim())?.[1];
      if (!token || token.length > 16384) throw new PreparerGatewayError(401, 'Sign in to WFC again.');
      const settings = preparerSettings(env), cookie = preparerCookie(req.headers.cookie), nonce = await challenge(settings, cookie);
      const response = await upstream(settings, '/api/session/handoff', cookie, 'POST', { token }, nonce.csrfToken), body = await boundedJson(response);
      if (!plain(body.user) || body.user.id !== req.userId || body.user.isAdmin !== true) throw unavailable();
      const newCookie = verifiedPreparerSetCookie(response.headers, settings.publicOrigin);
      // The original requireAdmin check predates the upstream awaits.
      if (!await currentAdmin(req.userId)) throw new PreparerGatewayError(403, 'Your administrator access changed. Sign in again before opening the preparer.');
      res.setHeader('Set-Cookie', newCookie); res.json({ url: settings.publicOrigin });
    } catch (error) {
      const safe = error instanceof PreparerGatewayError ? error : unavailable(); res.status(safe.status).json({ error: safe.message });
    }
  });
  router.delete('/session', authenticate, async (req: Request, res: ExpressResponse): Promise<void> => {
    let settings: Settings | undefined, revoked = false;
    try {
      settings = preparerSettings(env); const cookie = preparerCookie(req.headers.cookie);
      if (cookie && req.userId) {
        const nonce = await challenge(settings, cookie);
        if (nonce.authenticated === true && plain(nonce.user) && nonce.user.id === req.userId) {
          const response = await upstream(settings, '/api/session/logout', cookie, 'POST', {}, nonce.csrfToken);
          const body = await boundedJson(response); revoked = body.ok === true;
        }
      }
    } catch { /* An unavailable service cannot prevent local logout. */ }
    clearCookie(res, settings); res.json({ revoked });
  });
  return router;
}
