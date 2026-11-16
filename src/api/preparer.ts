import { ApiError } from './http';

export function validatedPreparerUrl(value: unknown): string {
  if (typeof value !== 'string') throw new ApiError(503, 'The model preparer address could not be verified.');
  let url: URL; try { url = new URL(value); } catch { throw new ApiError(503, 'The model preparer address could not be verified.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !['8083', '5193'].includes(url.port) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.origin !== value) throw new ApiError(503, 'The model preparer address could not be verified.');
  return url.origin;
}
export async function openPreparerSession(token: string, signal?: AbortSignal): Promise<{ url: string }> {
  const response = await fetch('/api/preparer/session', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
  const text = await response.text(); if (text.length > 32768) throw new ApiError(503, 'The model preparer returned an invalid response.');
  let data: unknown; try { data = JSON.parse(text); } catch { throw new ApiError(503, 'The model preparer could not be reached.'); }
  if (!response.ok) throw new ApiError(response.status, data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error.slice(0, 500) : 'The model preparer could not be opened.');
  if (!data || typeof data !== 'object' || Object.keys(data).sort().join(',') !== 'url') throw new ApiError(503, 'The model preparer returned an invalid response.');
  return { url: validatedPreparerUrl((data as { url: unknown }).url) };
}
export async function revokePreparerSession(token: string): Promise<boolean> {
  try { const response = await fetch('/api/preparer/session', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, credentials: 'same-origin', cache: 'no-store', redirect: 'error', keepalive: true, signal: AbortSignal.timeout(5000) }); return response.ok; }
  catch { return false; }
}
