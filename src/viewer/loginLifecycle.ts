// This registry belongs to the WFC parent. Credentials never enter the iframe.
const disposers = new Map<string, Set<() => void>>();

export function watchViewerLogin(token: string, dispose: () => void): () => void {
  const callbacks = disposers.get(token) ?? new Set<() => void>();
  callbacks.add(dispose);
  disposers.set(token, callbacks);
  return () => {
    callbacks.delete(dispose);
    if (!callbacks.size) disposers.delete(token);
  };
}

export function invalidateViewerLogin(token: string | null): void {
  if (!token) return;
  const callbacks = disposers.get(token);
  disposers.delete(token);
  for (const dispose of callbacks ?? []) dispose();
}

export type RevokeOutcome = 'acknowledged' | 'failed';
export async function revokeViewerLogin(token: string): Promise<RevokeOutcome> {
  const abort = new AbortController();
  const deadline = window.setTimeout(() => abort.abort(), 5_000);
  try {
    const response = await fetch('/api/viewer-sessions/revoke-login', {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
      credentials: 'same-origin', cache: 'no-store', signal: abort.signal,
    });
    return response.ok ? 'acknowledged' : 'failed';
  } catch { return 'failed'; }
  finally { window.clearTimeout(deadline); }
}
