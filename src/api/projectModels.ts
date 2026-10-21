import { getApiBaseUrl } from './http';

export interface ProjectModelSelection {
  projectId: string;
  activeModelVersionId: string | null;
  selectionRevision: number;
  updatedAt: string;
}
export type ModelSelection = ProjectModelSelection;
export interface ProjectModelVersion {
  id: string;
  projectId: string;
  label: string;
  source: { name: string; bytes: number; sha256: string; identityBasis: 'observed-local-file' | 'captured-at-conversion' };
  preparedAt: string;
  importedAt: string | null;
  state: 'ready';
  health: 'healthy' | 'unchecked' | 'unavailable';
}
export interface ProjectModelSnapshot { versions: ProjectModelVersion[]; selection: ProjectModelSelection }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const messages: Record<string, string> = {
  AUTH_REQUIRED: 'Sign in to view the project models.',
  ACCESS_DENIED: 'You do not have permission to change this project model.',
  PROJECT_NOT_FOUND: 'The project is no longer available.',
  MODEL_NOT_FOUND: 'The model version is no longer available in this project.',
  PACKAGE_NOT_FOUND: 'This older model has no saved ZIP. Generate it again to save a downloadable package.',
  PACKAGE_UNAVAILABLE: 'The saved model ZIP is unavailable. Try again later.',
  SELECTION_CONFLICT: 'The model selection changed elsewhere. Review the latest selection before saving.',
  MODEL_UNAVAILABLE: 'The model resources are unavailable. The active selection has not been replaced.',
  MODEL_NOT_SELECTABLE: 'This model version is not currently available for selection.',
  VERSION_NOT_READY: 'This model version is not ready for selection.',
  INVALID_REQUEST: 'The model selection request is invalid.',
  INVALID_RESPONSE: 'The model service returned invalid data. Refresh before saving.',
  NETWORK_ERROR: 'The model service could not be reached.',
  REGISTRY_FAILURE: 'The model service could not complete the request.',
};
export class ProjectModelApiError extends Error {
  readonly code: string;
  constructor(code: string, public readonly status: number | null = null) {
    const known = Object.hasOwn(messages, code) ? code : 'REGISTRY_FAILURE';
    super(messages[known]); this.name = 'ProjectModelApiError'; this.code = known;
  }
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const date = (value: unknown): value is string => typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
const invalid = (): never => { throw new ProjectModelApiError('INVALID_RESPONSE'); };

function selection(value: unknown, projectId: string): ProjectModelSelection {
  if (!record(value) || value.projectId !== projectId || !(value.activeModelVersionId === null || uuid(value.activeModelVersionId)) || !integer(value.selectionRevision) || !date(value.updatedAt)) return invalid();
  return { projectId, activeModelVersionId: value.activeModelVersionId, selectionRevision: value.selectionRevision, updatedAt: value.updatedAt };
}
function version(value: unknown, projectId: string): ProjectModelVersion {
  if (!record(value) || !uuid(value.id) || value.projectId !== projectId || typeof value.label !== 'string' || !value.label.trim() || !record(value.source) ||
    typeof value.source.name !== 'string' || !value.source.name || !integer(value.source.bytes) || typeof value.source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.source.sha256) ||
    typeof value.source.identityBasis !== 'string' || !['observed-local-file', 'captured-at-conversion'].includes(value.source.identityBasis) || !date(value.preparedAt) || !(value.importedAt === null || date(value.importedAt)) ||
    value.state !== 'ready' || typeof value.health !== 'string' || !['healthy', 'unchecked', 'unavailable'].includes(value.health)) return invalid();
  return { id: value.id, projectId, label: value.label, source: { name: value.source.name, bytes: value.source.bytes, sha256: value.source.sha256,
    identityBasis: value.source.identityBasis as ProjectModelVersion['source']['identityBasis'] }, preparedAt: value.preparedAt, importedAt: value.importedAt,
    state: 'ready', health: value.health as ProjectModelVersion['health'] };
}

async function readJson(response: Response): Promise<unknown> {
  // Metadata has a separate bounded reader; this never fetches model resources.
  const reader = response.body?.getReader();
  if (!reader) return invalid();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 8 * 1024 * 1024) return invalid(); chunks.push(chunk.value); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return invalid(); }
}
async function request(projectId: string, token: string, method: 'GET' | 'PATCH', signal?: AbortSignal, body?: unknown): Promise<unknown> {
  if (!uuid(projectId) || typeof token !== 'string' || !token) throw new ProjectModelApiError('INVALID_REQUEST');
  signal?.throwIfAborted();
  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}/api/projects/${projectId}/${method === 'GET' ? 'model-versions' : 'active-model'}`, {
      method, signal, cache: 'no-store', credentials: 'same-origin', redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, ...(method === 'PATCH' ? { 'Content-Type': 'application/json' } : {}) },
      ...(method === 'PATCH' ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) { if (signal?.aborted) throw error; throw new ProjectModelApiError('NETWORK_ERROR'); }
  if (!response.ok) {
    let code = response.status === 401 ? 'AUTH_REQUIRED' : response.status === 403 ? 'ACCESS_DENIED' : response.status === 404 ? 'PROJECT_NOT_FOUND' : 'REGISTRY_FAILURE';
    try { const value = await readJson(response); if (record(value) && typeof value.code === 'string' && Object.hasOwn(messages, value.code)) code = value.code; } catch { /* Keep HTTP status and static fallback; raw server text is never displayed. */ }
    throw new ProjectModelApiError(code, response.status);
  }
  try { return await readJson(response); } catch (error) { if (signal?.aborted) throw error; if (error instanceof ProjectModelApiError) throw error; return invalid(); }
}

export async function fetchProjectModels(projectId: string, token: string, options: { signal?: AbortSignal } = {}): Promise<ProjectModelSnapshot> {
  const value = await request(projectId, token, 'GET', options.signal);
  if (!record(value) || !Array.isArray(value.versions)) return invalid();
  const versions = value.versions.map(item => version(item, projectId));
  if (new Set(versions.map(item => item.id)).size !== versions.length) return invalid();
  return { versions, selection: selection(value.selection, projectId) };
}

/** Download uses the current login; no credential is placed in a URL or public object link. */
export async function downloadProjectModelPackage(projectId: string, versionId: string, token: string, options: { signal?: AbortSignal } = {}): Promise<{ blob: Blob; filename: string }> {
  if (!uuid(projectId) || !uuid(versionId) || !token) throw new ProjectModelApiError('INVALID_REQUEST');
  options.signal?.throwIfAborted();
  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}/api/projects/${projectId}/model-versions/${versionId}/package`, {
      method: 'GET', signal: options.signal, cache: 'no-store', credentials: 'same-origin', redirect: 'error',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (error) { if (options.signal?.aborted) throw error; throw new ProjectModelApiError('NETWORK_ERROR'); }
  if (!response.ok) {
    let code = response.status === 401 ? 'AUTH_REQUIRED' : response.status === 403 ? 'ACCESS_DENIED' : response.status === 404 ? 'PACKAGE_NOT_FOUND' : 'PACKAGE_UNAVAILABLE';
    try { const value = await readJson(response); if (record(value) && typeof value.code === 'string' && Object.hasOwn(messages, value.code)) code = value.code; } catch { /* Keep the safe status fallback. */ }
    throw new ProjectModelApiError(code, response.status);
  }
  const declared = response.headers.get('content-length');
  const expected = declared && /^[0-9]+$/.test(declared) ? Number(declared) : NaN;
  const reader = response.body?.getReader();
  if (!reader || response.headers.get('content-type')?.split(';')[0].trim() !== 'application/zip' ||
      !Number.isSafeInteger(expected) || expected < 0 || expected > 2 * 1024 ** 3) {
    await reader?.cancel().catch(() => {});
    return invalid();
  }
  const chunks: BlobPart[] = []; let bytes = 0;
  try {
    for (;;) {
      options.signal?.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > expected) return invalid();
      chunks.push(new Uint8Array(chunk.value).buffer);
    }
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (error instanceof ProjectModelApiError) throw error;
    throw new ProjectModelApiError('NETWORK_ERROR');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  options.signal?.throwIfAborted();
  if (bytes !== expected) return invalid();
  return { blob: new Blob(chunks, { type: 'application/zip' }), filename: `model-${versionId}.zip` };
}
export async function setProjectActiveModel(projectId: string, token: string, input: { modelVersionId: string | null; expectedSelectionRevision: number }, options: { signal?: AbortSignal } = {}): Promise<{ selection: ProjectModelSelection }> {
  if (!(input.modelVersionId === null || uuid(input.modelVersionId)) || !integer(input.expectedSelectionRevision) || input.expectedSelectionRevision === Number.MAX_SAFE_INTEGER) throw new ProjectModelApiError('INVALID_REQUEST');
  const value = await request(projectId, token, 'PATCH', options.signal, { modelVersionId: input.modelVersionId, expectedSelectionRevision: input.expectedSelectionRevision });
  if (!record(value)) return invalid();
  const result = selection(value.selection, projectId);
  if (result.activeModelVersionId !== input.modelVersionId || result.selectionRevision !== input.expectedSelectionRevision + 1) return invalid();
  return { selection: result };
}
