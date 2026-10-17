import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchProjectModels, setProjectActiveModel, ProjectModelApiError } from './projectModels';

vi.mock('./http', () => ({ getApiBaseUrl: () => 'http://fixture-api.invalid:4000' }));
const projectId = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const stamp = '2026-10-16T12:00:00.000Z';
const selection = (activeModelVersionId: string | null = id, selectionRevision = 1) => ({ projectId, activeModelVersionId, selectionRevision, updatedAt: stamp });
const version = () => ({ id, projectId, label: 'Model', source: { name: 'model.nwd', bytes: 123, sha256: 'a'.repeat(64), identityBasis: 'observed-local-file' }, preparedAt: stamp, importedAt: stamp, state: 'ready', health: 'healthy' });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe('project model metadata adapter', () => {
  it('uses the configured API base, explicit legacy token, no-store and caller signal without resource/session requests', async () => {
    fetchMock.mockResolvedValue(Response.json({ versions: [version()], selection: selection() }));
    const signal = new AbortController().signal;
    const result = await fetchProjectModels(projectId, 'legacy-token', { signal });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`http://fixture-api.invalid:4000/api/projects/${projectId}/model-versions`, expect.objectContaining({ method: 'GET', cache: 'no-store', signal, redirect: 'error', headers: { Authorization: 'Bearer legacy-token' } }));
    expect(result.versions[0].id).toBe(id);
  });

  it('sends exact explicit null/UUID CAS bodies and accepts only the correlated incremented acknowledgement', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ selection: selection(null, 2) })).mockResolvedValueOnce(Response.json({ selection: selection(id, 3) }));
    expect((await setProjectActiveModel(projectId, 'token', { modelVersionId: null, expectedSelectionRevision: 1 })).selection.activeModelVersionId).toBeNull();
    await setProjectActiveModel(projectId, 'token', { modelVersionId: id, expectedSelectionRevision: 2 });
    expect(fetchMock.mock.calls.map(call => JSON.parse(call[1].body))).toEqual([{ modelVersionId: null, expectedSelectionRevision: 1 }, { modelVersionId: id, expectedSelectionRevision: 2 }]);
    expect(fetchMock.mock.calls[0][0]).toBe(`http://fixture-api.invalid:4000/api/projects/${projectId}/active-model`);
    expect(fetchMock.mock.calls[0][1].headers['Content-Type']).toBe('application/json');
  });

  it('drops private/unneeded fields and keeps unavailable versions and missing active identity explicit', async () => {
    const value = { ...version(), health: 'unavailable', storagePrefix: 'private/path', manifest: { secrets: true } };
    fetchMock.mockResolvedValue(Response.json({ versions: [value], selection: selection('33333333-3333-4333-8333-333333333333'), secrets: true }));
    const result = await fetchProjectModels(projectId, 'token');
    expect(result.versions[0].health).toBe('unavailable'); expect(result.selection.activeModelVersionId).not.toBe(id);
    expect(JSON.stringify(result)).not.toMatch(/private|manifest|secrets/);
  });

  it('rejects duplicate identities, foreign projects, invalid revisions/dates and non-ready or malformed versions', async () => {
    const invalid = [
      { versions: [version(), version()], selection: selection() },
      { versions: [{ ...version(), projectId: id }], selection: selection() },
      { versions: [version()], selection: { ...selection(), projectId: id } },
      { versions: [version()], selection: { ...selection(), selectionRevision: -1 } },
      { versions: [version()], selection: { ...selection(), updatedAt: 'not-a-date' } },
      { versions: [{ ...version(), state: 'staging' }], selection: selection() },
      { versions: [{ ...version(), health: 'unknown' }], selection: selection() },
      { versions: [{ ...version(), health: ['healthy'] }], selection: selection() },
      { versions: [{ ...version(), source: { ...version().source, identityBasis: ['observed-local-file'] } }], selection: selection() },
      { versions: [{ ...version(), source: { ...version().source, sha256: 'invalid' } }], selection: selection() },
    ];
    for (const value of invalid) {
      fetchMock.mockResolvedValueOnce(Response.json(value));
      await expect(fetchProjectModels(projectId, 'token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });

  it('rejects malformed JSON/UTF-8 and an oversized metadata response', async () => {
    for (const response of [new Response('{'), new Response(new Uint8Array([255])), new Response('x'.repeat(8 * 1024 * 1024 + 1))]) {
      fetchMock.mockResolvedValueOnce(response);
      await expect(fetchProjectModels(projectId, 'token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });

  it.each([[409, 'SELECTION_CONFLICT'], [503, 'MODEL_UNAVAILABLE'], [409, 'MODEL_NOT_SELECTABLE'], [409, 'VERSION_NOT_READY']])('preserves safe server code %s/%s without server message content', async (status, code) => {
    fetchMock.mockResolvedValue(Response.json({ code, error: 'private-storage-path-and-token' }, { status }));
    await expect(fetchProjectModels(projectId, 'token')).rejects.toMatchObject({ status, code });
    try { await fetchProjectModels(projectId, 'token'); } catch (error) { expect(String(error)).not.toContain('private-storage-path'); }
  });

  it('retains status-based authorization failures even when a proxy returns non-JSON or an unknown code', async () => {
    fetchMock.mockResolvedValueOnce(new Response('private proxy body', { status: 401 })).mockResolvedValueOnce(Response.json({ code: 'SECRET_SQL', error: 'private SQL' }, { status: 403 }));
    await expect(fetchProjectModels(projectId, 'token')).rejects.toMatchObject({ code: 'AUTH_REQUIRED', status: 401 });
    await expect(fetchProjectModels(projectId, 'token')).rejects.toMatchObject({ code: 'ACCESS_DENIED', status: 403 });
  });

  it('rejects a wrong or nonincremented PATCH acknowledgement as an unknown response', async () => {
    for (const value of [selection(null, 2), selection(id, 1), selection(id, 3)]) {
      fetchMock.mockResolvedValueOnce(Response.json({ selection: value }));
      await expect(setProjectActiveModel(projectId, 'token', { modelVersionId: id, expectedSelectionRevision: 1 })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });

  it('validates request identities/revisions before fetch and forwards cancellation without inventing an HTTP failure', async () => {
    await expect(fetchProjectModels('../foreign', 'token')).rejects.toBeInstanceOf(ProjectModelApiError);
    await expect(setProjectActiveModel(projectId, 'token', { modelVersionId: id, expectedSelectionRevision: Infinity })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    const abort = new AbortController(); abort.abort();
    await expect(fetchProjectModels(projectId, 'token', { signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRejectedValue(new TypeError('private network exception'));
    await expect(fetchProjectModels(projectId, 'token')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: null });
  });
});
