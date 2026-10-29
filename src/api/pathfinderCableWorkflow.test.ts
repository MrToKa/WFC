import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy';
import { cableWorkflowPageSchema } from '../../shared/pathfinderCableWorkflow';
import { cableWorkflowQueryHashInput, cableWorkflowQuerySchema, cableWorkflowDetailQueryHashInput, cableWorkflowDetailQuerySchema } from '../../shared/pathfinderCableWorkflowQueries';
import { fetchPathFinderCableWorkflowPage, fetchPathFinderCableWorkflowDetail, CABLE_WORKFLOW_REQUEST_MILLISECONDS, CABLE_WORKFLOW_RESPONSE_BYTES } from './pathfinderCableWorkflow';

const id = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const project = id(1), cable = id(10), hash = 'a'.repeat(64);
const digest = (value: unknown) => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
const barrierIntent = (drillThroughWalls = false) => {
  const scope = { projectId: project, modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), selectionRevision: '3', captureFrameId: id(3), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' as const };
  return { schemaVersion: 'wfc.pf.barrier-admission-intent.v1' as const, scope, expectedRegistryRevision: '4', expectedSnapshot: { snapshotId: id(4), scope, registryRevision: '4', contentSha256: 'c'.repeat(64), mode: 'explicit-empty' as const }, drillThroughWalls };
};
function fixture(input = {}) {
  return cableWorkflowPageSchema.parse({ schemaVersion: 'wfc.pf.cable-workflow-page.v1', projectId: project,
    querySha256: digest(cableWorkflowQueryHashInput(cableWorkflowQuerySchema.parse(input))), contextSha256: hash, scannedCount: 1, scannedThroughCableId: cable, nextCursor: null, rows: [{
      projectId: project, mto: 'LV', cable: { id: cable, tag: 'Cable <script>', fromLocation: 'Å_100%\\', toLocation: 'B', routing: null, designLength: null, installLength: '0', cableWriteRevision: '2' },
      from: { status: 'missing', pointAvailable: false, source: null, approximate: false, candidateObjectIds: [], reasonCode: 'LOCATION_MISSING', engineeringAccepted: false },
      to: { status: 'confirmed-ready', pointAvailable: true, source: 'confirmed-shared-location', approximate: false, candidateObjectIds: [], reasonCode: null, engineeringAccepted: false },
      calculation: { jobId: null, jobStatus: null, itemState: null, outcome: 'not-evaluated', reasonCodes: [], errorCode: null, currentness: 'not-evaluated', proposalId: null, proposalHash: null, reviewable: false, acceptedMatchesCurrent: false },
    }] });
}
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('bounded read-only cable workflow transport', () => {
  it.each([false, true])('retains exact barrier JSON and hashes for list/detail requests (drill=%s)', async drillThroughWalls => {
    const input = { barrierRouting: barrierIntent(drillThroughWalls) }, page = fixture(input);
    const detail = { schemaVersion: 'wfc.pf.cable-workflow-detail.v1', projectId: project, cableId: cable, contextSha256: hash,
      querySha256: digest(cableWorkflowDetailQueryHashInput(cableWorkflowDetailQuerySchema.parse(input))), row: page.rows[0] };
    vi.mocked(fetch).mockResolvedValueOnce(response(page)).mockResolvedValueOnce(response(detail));
    await expect(fetchPathFinderCableWorkflowPage(project, 'token', input)).resolves.toEqual(page);
    await expect(fetchPathFinderCableWorkflowDetail(project, 'token', cable, input)).resolves.toEqual(detail);
    for (const [url] of vi.mocked(fetch).mock.calls) expect(new URL(String(url), 'http://local').searchParams.get('barrierRouting')).toBe(canonicalPurposeJson(input.barrierRouting));
  });
  it('refuses a malformed intent before a request and refuses a legacy query hash for a barrier-aware request', async () => {
    await expect(fetchPathFinderCableWorkflowPage(project, 'token', { barrierRouting: { ...barrierIntent(), drillThroughWalls: undefined } } as never)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(fetchPathFinderCableWorkflowDetail(project, 'token', cable, { barrierRouting: null } as never)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    const intent = barrierIntent(), scope = { ...intent.scope, projectId: id(99) }, foreign = { ...intent, scope, expectedSnapshot: { ...intent.expectedSnapshot, scope } };
    await expect(fetchPathFinderCableWorkflowPage(project, 'token', { barrierRouting: foreign })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(fetchPathFinderCableWorkflowDetail(project, 'token', cable, { barrierRouting: foreign })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(fetch).not.toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValueOnce(response(fixture()));
    await expect(fetchPathFinderCableWorkflowPage(project, 'token', { barrierRouting: barrierIntent() })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('sends only GET with current bearer/preferences and preserves literal NFC search and exact strings', async () => {
    const input = { search: '  A\u030a_100%\\  ', secondaryDistanceMeters: 0.0000001, preferVerticalApproach: false }, page = fixture(input), abort = new AbortController();
    vi.mocked(fetch).mockResolvedValueOnce(response(page));
    await expect(fetchPathFinderCableWorkflowPage(project, 'account-token', input, abort.signal)).resolves.toEqual(page);
    const [url, options] = vi.mocked(fetch).mock.calls[0], query = new URL(String(url), 'http://local').searchParams;
    expect(query.get('search')).toBe('Å_100%\\'); expect(query.get('secondaryDistanceMeters')).toBe('0.0000001'); expect(query.get('preferVerticalApproach')).toBe('false');
    expect(options).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error', credentials: 'same-origin', headers: { Authorization: 'Bearer account-token' } });
    expect(options?.signal).not.toBe(abort.signal); expect(options).not.toHaveProperty('body');
    expect(page.rows[0].cable.installLength).toBe('0');
  });
  it('reads the exact owned detail with a distinct preferences hash and no writes', async () => {
    const detail = { schemaVersion: 'wfc.pf.cable-workflow-detail.v1', projectId: project, cableId: cable, contextSha256: hash,
      querySha256: digest(cableWorkflowDetailQueryHashInput(cableWorkflowDetailQuerySchema.parse({}))), row: fixture().rows[0] };
    vi.mocked(fetch).mockResolvedValueOnce(response(detail));
    await expect(fetchPathFinderCableWorkflowDetail(project, 'token', cable)).resolves.toEqual(detail);
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain(`/cable-workflow/${cable}?secondaryDistanceMeters=2&preferVerticalApproach=true`);
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ method: 'GET' });
  });
  it('accepts an empty continuing scan without claiming that the project is empty', async () => {
    const page = { ...fixture(), rows: [], scannedCount: 200, nextCursor: 'next_chunk' };
    vi.mocked(fetch).mockResolvedValueOnce(response(page));
    await expect(fetchPathFinderCableWorkflowPage(project, 'token')).resolves.toMatchObject({ rows: [], nextCursor: 'next_chunk', scannedCount: 200 });
  });
  it('requires a full requested matching page to stop at its last returned cable instead of consuming omitted matches', async () => {
    const page = fixture({ limit: 2 }), second = { ...page.rows[0], cable: { ...page.rows[0].cable, id: id(20) } };
    vi.mocked(fetch).mockResolvedValueOnce(response({ ...page, rows: [...page.rows, second], scannedCount: 3, scannedThroughCableId: id(30), nextCursor: 'next_portion' }));
    await expect(fetchPathFinderCableWorkflowPage(project, 'token', { limit: 2 })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('rejects a row that does not satisfy the literal Unicode search even when the query hash is correct', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(fixture({ search: 'not this endpoint' })));
    await expect(fetchPathFinderCableWorkflowPage(project, 'token', { search: 'not this endpoint' })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it.each([
    { project: project + '\n', query: {} }, { project, query: { limit: 101 } }, { project, query: { cursor: '../other' } },
    { project, query: { search: 'invalid\nsearch' } }, { project, query: { secondaryDistanceMeters: Number.NaN } },
    { project, query: { extra: true } }, { project, query: { secondaryDistanceMeters: 5e-324 } },
  ])('refuses malformed or untransportable input without a request: %j', async test => {
    await expect(fetchPathFinderCableWorkflowPage(test.project, 'token', test.query)).rejects.toMatchObject({ code: 'INVALID_REQUEST' }); expect(fetch).not.toHaveBeenCalled();
  });
  it('refuses wrong ownership/query, MV leakage, filter leakage and invalid pages', async () => {
    const page = fixture();
    for (const value of [{ ...page, projectId: id(2), rows: [] }, { ...page, querySha256: 'b'.repeat(64) },
      { ...page, rows: [{ ...page.rows[0], mto: 'MV' }] }, { ...page, unexpected: true }, { ...page, rows: [page.rows[0], page.rows[0]] }]) {
      vi.mocked(fetch).mockResolvedValueOnce(response(value));
      await expect(fetchPathFinderCableWorkflowPage(project, 'token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
    vi.mocked(fetch).mockResolvedValueOnce(response(fixture({ filter: 'calculating' })));
    await expect(fetchPathFinderCableWorkflowPage(project, 'token', { filter: 'calculating' })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('rejects wrong detail cable and verifies both returned project identities', async () => {
    const value = { schemaVersion: 'wfc.pf.cable-workflow-detail.v1', projectId: project, cableId: id(11), contextSha256: hash,
      querySha256: digest(cableWorkflowDetailQueryHashInput(cableWorkflowDetailQuerySchema.parse({}))), row: { ...fixture().rows[0], cable: { ...fixture().rows[0].cable, id: id(11) } } };
    vi.mocked(fetch).mockResolvedValueOnce(response(value));
    await expect(fetchPathFinderCableWorkflowDetail(project, 'token', cable)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(fetchPathFinderCableWorkflowDetail(project, 'token', '../other')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('refuses escaped duplicate keys, invalid UTF8 and oversized bodies with best-effort cancellation', async () => {
    const cancel = vi.fn();
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{"projectId":"a","project\\u0049d":"b"}'))
      .mockResolvedValueOnce(new Response(new Uint8Array([0xff])))
      .mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(CABLE_WORKFLOW_RESPONSE_BYTES + 1)); }, cancel })));
    for (let i = 0; i < 3; i++) await expect(fetchPathFinderCableWorkflowPage(project, 'token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('returns current authority failure immediately without awaiting an untrusted body or exposing server text', async () => {
    const cancel = vi.fn(); vi.mocked(fetch).mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { status: 403 }));
    await expect(fetchPathFinderCableWorkflowPage(project, 'token')).rejects.toMatchObject({ status: 403, message: 'Administrator access is required. Sign in again before continuing.' });
    expect(cancel).toHaveBeenCalledOnce();
    vi.mocked(fetch).mockResolvedValueOnce(response({ code: 'CONTEXT_CHANGED', error: '<private business values>' }, 409));
    await expect(fetchPathFinderCableWorkflowPage(project, 'token')).rejects.toMatchObject({ status: 409, code: 'CONTEXT_CHANGED', message: 'The project changed. Refresh the cable list before continuing.' });
  });
  it('bounds fetch and body reads even when the underlying request ignores cancellation', async () => {
    vi.useFakeTimers(); vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => {}));
    const pending = expect(fetchPathFinderCableWorkflowPage(project, 'token')).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(CABLE_WORKFLOW_REQUEST_MILLISECONDS); await pending;
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new ReadableStream()));
    const bodyPending = expect(fetchPathFinderCableWorkflowPage(project, 'token')).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(CABLE_WORKFLOW_REQUEST_MILLISECONDS); await bodyPending;
  });
  it('cancels ownership immediately and disposes any late response body', async () => {
    const abort = new AbortController(), cancel = vi.fn(); let finish!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = expect(fetchPathFinderCableWorkflowPage(project, 'token', {}, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    abort.abort(); await pending; finish(new Response(new ReadableStream({ cancel }))); await Promise.resolve();
    expect(cancel).toHaveBeenCalledOnce();
  });
});
