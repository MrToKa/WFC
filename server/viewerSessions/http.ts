import type { Request } from 'express';
import { ViewerSessionError } from './errors.js';

export interface ViewerHttpPolicy { origins: readonly string[]; allowHttpLoopback: boolean; trustProxy: boolean }
const loopback = (hostname: string): boolean => ['localhost','127.0.0.1','[::1]'].includes(hostname);
export function viewerHttpPolicy(env: Record<string,string | undefined> = process.env): ViewerHttpPolicy {
  const origins = (env.WFC_VIEWER_ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  const policy = { origins,allowHttpLoopback: env.WFC_VIEWER_ALLOW_HTTP_LOOPBACK === 'true',trustProxy: env.WFC_VIEWER_TRUST_PROXY === 'true' };
  for (const origin of origins) {
    let parsed: URL;
    try { parsed = new URL(origin); } catch { throw new Error('Invalid WFC viewer origin configuration'); }
    if (parsed.origin !== origin || !['https:','http:'].includes(parsed.protocol) ||
      parsed.protocol === 'http:' && (!policy.allowHttpLoopback || !loopback(parsed.hostname))) throw new Error('Invalid WFC viewer origin configuration');
  }
  return policy;
}
export function requireViewerOrigin(req: Request,policy: ViewerHttpPolicy,mutation: boolean): { secure: boolean } {
  const tls = (req.socket as typeof req.socket & { encrypted?: boolean }).encrypted === true;
  const forwarded = req.header('x-forwarded-proto');
  let scheme = tls ? 'https' : 'http';
  if (policy.trustProxy && forwarded !== undefined) {
    if (forwarded !== 'http' && forwarded !== 'https') throw new ViewerSessionError('VIEWER_ORIGIN_DENIED',403);
    if (!tls) scheme = forwarded;
  }
  const host = req.header('host');
  if (!host || !/^[a-zA-Z0-9.:[\]-]+$/.test(host)) throw new ViewerSessionError('VIEWER_ORIGIN_DENIED',403);
  const origin = `${scheme}://${host}`;
  if (!policy.origins.includes(origin)) throw new ViewerSessionError('VIEWER_ORIGIN_DENIED',403);
  const parsed = new URL(origin);
  if (scheme === 'http' && (!policy.allowHttpLoopback || !loopback(parsed.hostname))) throw new ViewerSessionError('VIEWER_ORIGIN_DENIED',403);
  if ((mutation || req.header('origin') !== undefined) && req.header('origin') !== origin) throw new ViewerSessionError('VIEWER_ORIGIN_DENIED',403);
  const site = req.header('sec-fetch-site');
  if (site !== undefined && site !== 'same-origin') throw new ViewerSessionError('VIEWER_ORIGIN_DENIED',403);
  return { secure: scheme === 'https' };
}
export function viewerCookieSecret(header: string | undefined): string {
  const cookies = (header ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith('wfc_viewer_session='));
  if (cookies.length !== 1) throw new ViewerSessionError('AUTH_REQUIRED',401);
  const value = cookies[0].slice('wfc_viewer_session='.length);
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new ViewerSessionError('AUTH_REQUIRED',401);
  return value;
}
export function resourceManifestPath(raw: string): string {
  let value: string;
  try { value = decodeURIComponent(raw); } catch { throw new ViewerSessionError('RESOURCE_NOT_FOUND',404); }
  if (!value || /[%\\\x00-\x1f\x7f]/.test(value) || /%(?:2f|5c)/i.test(raw) ||
    value.split('/').some(part => !part || part === '.' || part === '..')) throw new ViewerSessionError('RESOURCE_NOT_FOUND',404);
  return `resources/${value}`;
}
/** The pinned SDK adds this same-origin credential metadata to its local resource requests. */
export function validateViewerQuery(originalUrl: string,resourceOrigin?: string): void {
  const query = originalUrl.indexOf('?');
  if (query < 0) return;
  const params = new URLSearchParams(originalUrl.slice(query+1));
  if (!resourceOrigin || params.size !== 1 || !params.has('domain') || params.get('domain') !== resourceOrigin) {
    throw new ViewerSessionError('INVALID_VIEWER_REQUEST');
  }
}
export function resourceRange(header: string | undefined,bytes: number): { start: number; end: number } | null {
  if (header === undefined) return null;
  const match = /^bytes=([0-9]*)-([0-9]*)$/.exec(header.trim());
  if (!match || !match[1] && !match[2] || bytes === 0) throw new ViewerSessionError('RANGE_NOT_SATISFIABLE',416);
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new ViewerSessionError('RANGE_NOT_SATISFIABLE',416);
    return { start: Math.max(0,bytes-suffix),end: bytes-1 };
  }
  const start = Number(match[1]),end = match[2] ? Number(match[2]) : bytes-1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= bytes || start > end) throw new ViewerSessionError('RANGE_NOT_SATISFIABLE',416);
  return { start,end: Math.min(end,bytes-1) };
}
