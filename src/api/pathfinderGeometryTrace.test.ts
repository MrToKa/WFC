// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchGeometryTraces,
  fetchGeometryTraceManifest,
  fetchGeometryObjectRevision,
  fetchCaptureEvidence,
  createGeometryTrace,
} from './pathfinderGeometryTrace';
import { geometryTraceFixture, completedEvidenceFixture } from '@/test/geometryTraceFixtures';
import { preparationIds as ids } from '@/test/preparationFixtures';
afterEach(() => vi.unstubAllGlobals());
describe('fixed strict traceability transport', () => {
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
