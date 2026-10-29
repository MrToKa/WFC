export type ViewerSession = {
  sessionId: string; projectId: string; modelVersionId: string; loadId: string;
  expiresAt: string; absoluteExpiresAt: string;
};
export type ModelSelection = Pick<import('../api/projectModels').ProjectModelSelection, 'activeModelVersionId' | 'selectionRevision'>;

export class ViewerAccessError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code); }
}

export function sessionBase(projectId: string, modelVersionId: string, sessionId?: string): string {
  const base = `/api/projects/${projectId}/model-versions/${modelVersionId}/viewer-sessions`;
  return sessionId ? `${base}/${sessionId}/` : base;
}

export async function viewerRequest<T>(path: string, token: string, options: {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown; signal?: AbortSignal;
} = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? 'GET', signal: options.signal,
    credentials: 'same-origin', cache: 'no-store', mode: 'same-origin', redirect: 'error',
    headers: { Authorization: `Bearer ${token}`, ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) {
    let code = 'RESOURCE_FAILED';
    try { const body = await response.json(); if (typeof body.code === 'string') code = body.code; } catch { /* no diagnostic body is trusted */ }
    throw new ViewerAccessError(code, response.status);
  }
  return response.status === 204 ? undefined as T : await response.json() as T;
}
