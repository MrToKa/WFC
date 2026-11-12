// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchGeometryTraces,
  fetchGeometryTraceRuntime,
  buildGeometryTraceCommand,
  fetchGeometryTraceManifest,
  fetchGeometryObjectRevision,
  fetchCaptureEvidence,
  createGeometryTrace,
  GeometryTraceApiError,
  GEOMETRY_TRACE_REQUEST_TIMEOUT_MS,
} from './pathfinderGeometryTrace';
import { geometryTraceFixture, geometryTraceRuntimeFixture, completedEvidenceFixture } from '@/test/geometryTraceFixtures';
import { preparationIds as ids } from '@/test/preparationFixtures';
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('fixed strict traceability transport', () => {
  it('verifies the authorized runtime fingerprint and refuses an altered digest', async () => {
    const runtime = geometryTraceRuntimeFixture(), fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(runtime)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...runtime, runtimeFingerprintSha256: 'f'.repeat(64) })));
    vi.stubGlobal('fetch', fetch);
    await expect(fetchGeometryTraceRuntime(ids.project, 'token')).resolves.toEqual(runtime);
    expect(fetch.mock.calls[0][0]).toMatch(/\/geometry-traces\/runtime$/);
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'GET', cache: 'no-store', headers: { Authorization: 'Bearer token' } });
    await expect(fetchGeometryTraceRuntime(ids.project, 'token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('uses one deterministic command per runtime and sends both current and retained legacy bodies exactly', async () => {
    const { manifest } = geometryTraceFixture(), firstRuntime = geometryTraceRuntimeFixture(), nextRuntime = geometryTraceRuntimeFixture('b'.repeat(64));
    const first = await buildGeometryTraceCommand(ids.project, manifest.aggregateId, manifest.projection.sha256, firstRuntime.runtimeFingerprintSha256);
    expect(await buildGeometryTraceCommand(ids.project, manifest.aggregateId, manifest.projection.sha256, firstRuntime.runtimeFingerprintSha256)).toEqual(first);
    const next = await buildGeometryTraceCommand(ids.project, manifest.aggregateId, manifest.projection.sha256, nextRuntime.runtimeFingerprintSha256);
    expect(next.idempotencyKey).not.toBe(first.idempotencyKey); expect(next.expectedRuntimeFingerprintSha256).toBe(nextRuntime.runtimeFingerprintSha256);
    const legacy = { schemaVersion: 'wfc.pf.geometry-trace-create.v1' as const, aggregateId: manifest.aggregateId, expectedProjectionSha256: manifest.projection.sha256,
      derivationVersion: manifest.derivationVersion, idempotencyKey: ids.actor };
    const receipt = { schemaVersion: 'wfc.pf.geometry-trace-receipt.v1', trace: manifest, duplicate: true };
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(receipt))); vi.stubGlobal('fetch', fetch);
    await createGeometryTrace(ids.project, 'token', first); await createGeometryTrace(ids.project, 'token', legacy);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(first); expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual(legacy);
    await expect(createGeometryTrace(ids.project, 'token', next)).rejects.toMatchObject({ code: 'INVALID_RESPONSE', outcome: 'unknown' });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('retains a verified successful POST receipt when presentation is aborted during runtime digest verification', async () => {
    const { manifest } = geometryTraceFixture(), runtime = geometryTraceRuntimeFixture(), controller = new AbortController();
    const command = await buildGeometryTraceCommand(ids.project, manifest.aggregateId, manifest.projection.sha256, runtime.runtimeFingerprintSha256);
    const receipt = { schemaVersion: 'wfc.pf.geometry-trace-receipt.v1', trace: manifest, duplicate: false };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(receipt))));
    const realDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
    let calls = 0;
    const digest = vi.fn<typeof realDigest>(async (algorithm, data) => {
      const result = await realDigest(algorithm, data);
      if (++calls === 2) controller.abort(new DOMException('Active model changed.', 'AbortError'));
      return result;
    });
    vi.stubGlobal('crypto', { subtle: { digest } });
    await expect(createGeometryTrace(ids.project, 'token', command, controller.signal)).resolves.toEqual(receipt);
    expect(controller.signal.aborted).toBe(true); expect(digest).toHaveBeenCalledTimes(2);
  });
  it('reads bounded summaries and exact object/manifest identities through fixed paths', async () => {
    const { manifest, list, record } = geometryTraceFixture(),
      fetch = vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(list)))
        .mockResolvedValueOnce(new Response(JSON.stringify(manifest)))
        .mockResolvedValueOnce(new Response(JSON.stringify(record)));
    vi.stubGlobal('fetch', fetch);
    await expect(fetchGeometryTraces(ids.project, 'token')).resolves.toEqual(list);
    await expect(fetchGeometryTraceManifest(ids.project, 'token', manifest.id)).resolves.toEqual(
      manifest,
    );
    await expect(
      fetchGeometryObjectRevision(ids.project, 'token', manifest.id, record.id),
    ).resolves.toEqual(record);
    expect(fetch.mock.calls[0][0]).toMatch(/\/geometry-traces\?offset=0&limit=25$/);
    expect(fetch.mock.calls[2][0]).toMatch(
      new RegExp(`/geometry-traces/${manifest.id}/objects/${record.id}$`),
    );
  });
  it('refuses newline identities, duplicate JSON and altered immutable manifest bytes', async () => {
    const { manifest } = geometryTraceFixture(),
      fetch = vi
        .fn()
        .mockResolvedValueOnce(new Response('{"schemaVersion":1,"\\u0073chemaVersion":2}'))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ...manifest, geometryRevision: '2' })),
        );
    vi.stubGlobal('fetch', fetch);
    await expect(
      fetchGeometryTraceManifest(ids.project + '\n', 'token', manifest.id),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    await expect(fetchGeometryTraceManifest(ids.project, 'token', manifest.id)).rejects.toThrow();
    await expect(fetchGeometryTraceManifest(ids.project, 'token', manifest.id)).rejects.toThrow();
  });
  it('verifies completed evidence hash and refuses unsupported outgoing command fields', async () => {
    const evidence = await completedEvidenceFixture(),
      fetch = vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(evidence)))
        .mockResolvedValueOnce(new Response(JSON.stringify({ ...evidence, diagnostics: [] })));
    vi.stubGlobal('fetch', fetch);
    await expect(
      fetchCaptureEvidence(ids.project, 'token', ids.session, ids.part),
    ).resolves.toEqual(evidence);
    await expect(
      fetchCaptureEvidence(ids.project, 'token', ids.session, ids.part),
    ).rejects.toThrow();
    await expect(
      createGeometryTrace(ids.project, 'token', { unknown: true } as never),
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('bounded geometry trace request lifetime', () => {
  const create = (signal?: AbortSignal) => {
    const { manifest } = geometryTraceFixture();
    return createGeometryTrace(ids.project, 'token', { schemaVersion: 'wfc.pf.geometry-trace-create.v1', aggregateId: manifest.aggregateId, expectedProjectionSha256: manifest.projection.sha256, derivationVersion: manifest.derivationVersion, idempotencyKey: ids.actor }, signal);
  };

  it('times out an abort-ignoring create fetch with unknown outcome and consumes a late rejection', async () => {
    vi.useFakeTimers();
    let rejectFetch!: (error: Error) => void;
    const fetch = vi.fn((_url: unknown, _options: RequestInit) => new Promise<Response>((_resolve, reject) => { rejectFetch = reject; }));
    vi.stubGlobal('fetch', fetch);
    const pending = create(), refused = expect(pending).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT', status: null, outcome: 'unknown' });
    await vi.advanceTimersByTimeAsync(GEOMETRY_TRACE_REQUEST_TIMEOUT_MS); await refused;
    expect(fetch.mock.calls[0][1].signal?.aborted).toBe(true);
    rejectFetch(new TypeError('Late transport failure'));
    await Promise.resolve(); await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses one combined deadline for fetch and body even when read and cancel never finish', async () => {
    vi.useFakeTimers();
    let resolveFetch!: (response: Response) => void;
    const reader = { read: vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(() => {})), cancel: vi.fn(() => new Promise<void>(() => {})), releaseLock: vi.fn() };
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { resolveFetch = resolve; })));
    const pending = create(), refused = expect(pending).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT', outcome: 'unknown' });
    await vi.advanceTimersByTimeAsync(60_000);
    resolveFetch({ ok: true, status: 200, body: { getReader: () => reader } } as unknown as Response);
    await vi.advanceTimersByTimeAsync(0); expect(reader.read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(GEOMETRY_TRACE_REQUEST_TIMEOUT_MS - 60_000); await refused;
    expect(reader.cancel).toHaveBeenCalledTimes(1); expect(reader.releaseLock).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['fetch', 'body'] as const)('preserves the caller abort reason during %s and removes its listener', async phase => {
    vi.useFakeTimers();
    const controller = new AbortController(), reason = new DOMException('Traceability context changed.', 'AbortError');
    const add = vi.spyOn(controller.signal, 'addEventListener'), remove = vi.spyOn(controller.signal, 'removeEventListener');
    const reader = { read: vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(() => {})), cancel: vi.fn(async () => {}), releaseLock: vi.fn() };
    const fetch = phase === 'fetch' ? vi.fn(() => new Promise<Response>(() => {})) : vi.fn().mockResolvedValue({ ok: true, status: 200, body: { getReader: () => reader } } as unknown as Response);
    vi.stubGlobal('fetch', fetch);
    const pending = fetchGeometryTraces(ids.project, 'token', 0, controller.signal), refused = expect(pending).rejects.toBe(reason);
    await vi.advanceTimersByTimeAsync(0); controller.abort(reason); await refused;
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0][1]); expect(vi.getTimerCount()).toBe(0);
    if (phase === 'body') expect(reader.cancel).toHaveBeenCalledTimes(1);
  });

  it('refuses an already aborted caller before fetch or timer creation', async () => {
    vi.useFakeTimers();
    const controller = new AbortController(), reason = new DOMException('Paused.', 'AbortError'); controller.abort(reason);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(fetchGeometryTraces(ids.project, 'token', 0, controller.signal)).rejects.toBe(reason);
    expect(fetch).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it('clears deadline and caller listener after success and preserves definite server errors', async () => {
    vi.useFakeTimers();
    const { list } = geometryTraceFixture(), controller = new AbortController(), remove = vi.spyOn(controller.signal, 'removeEventListener');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(list))).mockResolvedValueOnce(new Response(JSON.stringify({
      schemaVersion: 'wfc.pf.geometry-trace-error.v1', code: 'GEOMETRY_TRACE_STALE', message: 'Refresh traceability.', outcome: 'refused',
    }), { status: 409 })));
    await expect(fetchGeometryTraces(ids.project, 'token', 0, controller.signal)).resolves.toEqual(list);
    expect(remove).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    const refusal = create(); await expect(refusal).rejects.toBeInstanceOf(GeometryTraceApiError);
    await expect(refusal).rejects.toMatchObject({ code: 'GEOMETRY_TRACE_STALE', status: 409, outcome: 'refused' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
