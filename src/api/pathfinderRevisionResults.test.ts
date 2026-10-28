import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRevisionAdmissions, fetchRevisionResultsPage, fetchRevisionResultDetail } from './pathfinderRevisionResults';
import { REVISION_RESULTS_LIMITS, revisionAdmissionsPageSchema, revisionResultsPageSchema, revisionResultDetailSchema } from '../../shared/pathfinderRevisionResults';

const id = (value: number) => `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const project = id(1), admission = id(2), cable = id(3), hash = 'a'.repeat(64);
function fixtures() {
  const admissions = revisionAdmissionsPageSchema.parse({ schemaVersion: 'wfc.pf.revision-admissions-page.v1', projectId: project,
    admissions: [{ id: admission, projectId: project, jobId: null, generation: '7', kind: 'automatic', inputSha256: hash, total: 2140, modelRef: null, createdAt: '2026-10-19T12:00:00Z' }], nextCursor: 'opaque_cursor' });
  const page = revisionResultsPageSchema.parse({ schemaVersion: 'wfc.pf.revision-results-page.v1', projectId: project, admissionId: admission, rows: [{
    cableId: cable, baseline: { schemaVersion: 'wfc.pf.cable-revision-baseline.v1', currentCable: { id: cable, tag: 'C-001', fromLocation: 'A', toLocation: 'B', routing: '/OLD', designLength: '7.00000000000000000001', installLength: '6.50', cableWriteRevision: '8' }, lastAcceptedApply: null, acceptedMatchesCurrent: false },
    baselineHash: hash, status: 'locations_required', message: 'Resolve the shared location.', result: null, currentness: { state: 'current', reasonCodes: [] },
  }], nextAfterCableId: cable });
  const detail = revisionResultDetailSchema.parse({ schemaVersion: 'wfc.pf.revision-result-detail.v1', projectId: project, admissionId: admission, row: page.rows[0], envelope: null, engineResult: null, dependencies: null });
  return { admissions, page, detail };
}
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());

describe('bounded immutable revision-result transport', () => {
  it('uses fixed read-only paths, supplied bearer and signal, and preserves exact numeric strings', async () => {
    const f = fixtures(), signal = new AbortController().signal;
    vi.mocked(fetch).mockResolvedValueOnce(response(f.admissions)).mockResolvedValueOnce(response(f.page)).mockResolvedValueOnce(response(f.detail));
    await expect(fetchRevisionAdmissions(project, 'token', { cursor: 'saved_cursor', limit: 50 }, signal)).resolves.toEqual(f.admissions);
    await expect(fetchRevisionResultsPage(project, 'token', admission, { afterCableId: id(0), limit: 100 }, signal)).resolves.toEqual(f.page);
    await expect(fetchRevisionResultDetail(project, 'token', admission, cable, signal)).resolves.toEqual(f.detail);
    expect(fetch).toHaveBeenNthCalledWith(1, expect.stringContaining('/revision-results/admissions?limit=50&cursor=saved_cursor'), expect.objectContaining({ method: 'GET', signal, cache: 'no-store', redirect: 'error', headers: { Authorization: 'Bearer token' } }));
    expect(fetch).toHaveBeenNthCalledWith(2, expect.stringContaining(`/admissions/${admission}/cables?limit=100&afterCableId=${id(0)}`), expect.objectContaining({ method: 'GET' }));
    expect(fetch).toHaveBeenNthCalledWith(3, expect.stringContaining(`/admissions/${admission}/cables/${cable}`), expect.objectContaining({ method: 'GET' }));
    for (const [, options] of vi.mocked(fetch).mock.calls) expect(options).not.toHaveProperty('body');
    expect(f.detail.row.baseline.currentCable.designLength).toBe('7.00000000000000000001');
  });
  it('rejects wrong project, admission and selected cable before returning data', async () => {
    const f = fixtures();
    vi.mocked(fetch).mockResolvedValueOnce(response({ ...f.admissions, projectId: id(90), admissions: [] }))
      .mockResolvedValueOnce(response({ ...f.page, admissionId: id(91) }))
      .mockResolvedValueOnce(response({ ...f.detail, row: { ...f.detail.row, cableId: id(92), baseline: { ...f.detail.row.baseline, currentCable: { ...f.detail.row.baseline.currentCable, id: id(92) } } } }));
    await expect(fetchRevisionAdmissions(project, 'token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(fetchRevisionResultsPage(project, 'token', admission)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(fetchRevisionResultDetail(project, 'token', admission, cable)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('refuses malformed identities, cursor injection and oversized pages before any network request', async () => {
    await expect(fetchRevisionAdmissions(project + '\n', 'token')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(fetchRevisionAdmissions(project, 'token', { cursor: '../other' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(fetchRevisionAdmissions(project, 'token', { limit: 101 })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(fetchRevisionResultsPage(project, 'token', admission, { afterCableId: 'not-a-cable' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(fetchRevisionResultDetail(project, 'token', admission + '/other', cable)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('refuses duplicate keys, invalid UTF-8 and unknown top-level fields', async () => {
    const f = fixtures();
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{"projectId":"x","\\u0070rojectId":"y"}'))
      .mockResolvedValueOnce(new Response(new Uint8Array([0xff])))
      .mockResolvedValueOnce(response({ ...f.admissions, loginToken: 'not-allowed' }));
    for (let at = 0; at < 3; at++) await expect(fetchRevisionAdmissions(project, 'token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('cancels an oversized stream at the shared page budget', async () => {
    const cancelled = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(REVISION_RESULTS_LIMITS.pageBytes + 1)); }, cancel: cancelled });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(stream));
    await expect(fetchRevisionAdmissions(project, 'token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it('cancels a pending response reader when its ownership signal ends', async () => {
    const cancelled = vi.fn(), abort = new AbortController();
    const stream = new ReadableStream<Uint8Array>({ cancel: cancelled });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(stream));
    const pending = fetchRevisionAdmissions(project, 'token', {}, abort.signal);
    await Promise.resolve(); expect(stream.locked).toBe(true);
    abort.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it('preserves denied HTTP authority even when its error body is not JSON and never displays arbitrary server text', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('<html>private details</html>', { status: 401 }))
      .mockResolvedValueOnce(response({ code: 'ADMIN_REQUIRED', message: 'private internal failure' }, 403));
    await expect(fetchRevisionAdmissions(project, 'token')).rejects.toMatchObject({ status: 401, message: 'Administrator access is required. Refresh your account before continuing.' });
    await expect(fetchRevisionAdmissions(project, 'token')).rejects.toMatchObject({ status: 403, code: 'ADMIN_REQUIRED', message: 'Administrator access is required. Refresh your account before continuing.' });
  });
});
