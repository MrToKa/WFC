import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { beginBarrierCapture, changeBarrierRegistry, getBarrierRegistry, getLatestBarrierSnapshot, BARRIER_READ_MILLISECONDS } from './pathfinderBarriers';
import { BARRIER_LIMITS, barrierCanonicalJson, barrierSnapshotHashInput, barrierSnapshotSchema, type BarrierSnapshot } from '../../shared/pathfinderBarriers';
const id = (n: number) => `b2000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { projectId: id(1), modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), selectionRevision: '1',
  captureFrameId: id(3), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' as const };
const registry = { schemaVersion: 'wfc.pf.barrier-registry.v1', scope, registryRevision: '0', state: 'unconfigured',
  selectedParents: [], snapshot: null, reasonCodes: ['NO_BARRIER_SCOPE_CONFIGURED'] };
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('reads the exact API route with login and detached strict registry shape', async () => {
  const fetcher = vi.fn(async () => Response.json(registry)); vi.stubGlobal('fetch', fetcher);
  expect(await getBarrierRegistry(id(1), 'synthetic-token')).toEqual(registry);
  expect(fetcher.mock.calls[0]).toEqual([expect.stringMatching(new RegExp(`/api/projects/${id(1)}/pathfinder/barriers$`)),
    expect.objectContaining({ credentials: 'same-origin', redirect: 'error', headers: { Authorization: 'Bearer synthetic-token' } })]);
});
it('refuses caller authority fields before sending an empty declaration', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const command = { schemaVersion: 'wfc.pf.barrier-registry-command.v1' as const, action: 'declare-empty' as const,
    scope, expectedRegistryRevision: '0', idempotencyKey: id(4), reason: 'Synthetic scope', actorId: id(9) };
  await expect(changeBarrierRegistry(id(1), 'synthetic-token', command)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
});
it('retains a specific public denial without retrying or accepting a ready-shaped error', async () => {
  const fetcher = vi.fn(async () => Response.json({ code: 'ADMIN_REQUIRED', state: 'ready' }, { status: 403 })); vi.stubGlobal('fetch', fetcher);
  await expect(getBarrierRegistry(id(1), 'synthetic-token')).rejects.toMatchObject({ code: 'ADMIN_REQUIRED', status: 403 });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('validates server intent identities and rejects extra authority before a capture can start', async () => {
  const command = { schemaVersion: 'wfc.pf.barrier-capture-command.v1' as const, scope, expectedRegistryRevision: '0', idempotencyKey: id(5),
    selectedParents: [{ selectionId: id(6), kind: 'wall' as const, objectId: 'dbid:7', dbId: 7, externalId: null, name: 'Synthetic wall',
      identityBasis: 'version-local-only' as const, inclusion: 'own-and-all-descendant-fragments' as const }] };
  const fetcher = vi.fn(async () => Response.json({ schemaVersion: 'wfc.pf.barrier-intent-receipt.v1', state: 'pending', duplicate: false,
    intent: { id: id(7), snapshotId: id(8), captureBlobId: id(9), manifestBlobId: id(10), command, createdBy: id(11), loginId: id(12), path: '/caller-path' } }));
  vi.stubGlobal('fetch', fetcher); await expect(beginBarrierCapture(id(1), 'synthetic-token', command)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

function savedSnapshot(empty = false): BarrierSnapshot {
  const parent = { selectionId: id(10), kind: 'wall', objectId: 'dbid:7', dbId: 7, externalId: null, name: 'Saved civil wall',
    identityBasis: 'version-local-only', inclusion: 'own-and-all-descendant-fragments' };
  const snapshot = barrierSnapshotSchema.parse({ schemaVersion: 'wfc.pf.barrier-snapshot.v1', snapshotId: id(11), scope, registryRevision: '1',
    contentSha256: '0'.repeat(64), selectedParents: empty ? [] : [parent], capture: empty ? null : { captureId: id(12), payloadSha256: 'c'.repeat(64) },
    geometry: empty ? { mode: 'explicit-empty', declarationId: id(13), declaration: 'administrator-declared-no-selected-barriers', reason: 'Saved empty selection' }
      : { mode: 'mesh-set', fragments: [{ source: { fragmentId: 0, ownerObjectId: 'dbid:7', parentSelectionIds: [id(10)], sourceUnits: 'm', metresPerSourceUnit: 1,
        sourceToWorldMetres: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], transformSha256: 'd'.repeat(64) },
        bounds: { minimum: [0, 0, 0], maximum: [1, 1, 1] }, mesh: { blobId: id(14), sha256: 'e'.repeat(64), bytes: 256 }, vertices: 8, triangles: 12 }],
      verification: { producerVersion: 'wfc.pf.barrier-verifier.v1', selectionClosure: 'complete-selected-scope', topology: 'qualified-closed-consistent-two-manifold',
        selfIntersection: 'bounded-verification-passed', computationalMeshes: 1, verifiedCaptureSha256: 'c'.repeat(64), verificationSha256: 'f'.repeat(64) } },
    coverage: 'registered-selected-objects-only', engineeringAccepted: false });
  snapshot.contentSha256 = createHash('sha256').update(barrierCanonicalJson(barrierSnapshotHashInput(snapshot))).digest('hex'); return snapshot;
}
function history(snapshot: BarrierSnapshot) {
  return { schemaVersion: 'wfc.pf.barrier-snapshot-list.v1', projectId: id(1), offset: 0, nextOffset: 1,
    snapshots: [{ snapshotId: snapshot.snapshotId, scope: snapshot.scope, registryRevision: snapshot.registryRevision, contentSha256: snapshot.contentSha256, mode: snapshot.geometry.mode }] };
}
it('reads one newest saved reference and its hash-verified manifest without scanning older snapshots or writing', async () => {
  const snapshot = savedSnapshot(), page = history(snapshot), fetcher = vi.fn().mockResolvedValueOnce(Response.json(page)).mockResolvedValueOnce(Response.json(snapshot));
  vi.stubGlobal('fetch', fetcher); expect(await getLatestBarrierSnapshot(id(1), 'synthetic-token')).toEqual(snapshot);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.map(call => String(call[0]))).toEqual([expect.stringMatching(/\/barriers\/snapshots\?limit=1$/), expect.stringMatching(new RegExp(`/snapshots/${id(11)}$`))]);
  for (const [, options] of fetcher.mock.calls) expect(options).toMatchObject({ method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { Authorization: 'Bearer synthetic-token' } });
});
it('keeps the newest explicit-empty declaration and never resurrects an older nonempty set', async () => {
  const snapshot = savedSnapshot(true), fetcher = vi.fn().mockResolvedValueOnce(Response.json(history(snapshot))).mockResolvedValueOnce(Response.json(snapshot));
  vi.stubGlobal('fetch', fetcher); expect((await getLatestBarrierSnapshot(id(1), 'synthetic-token'))?.geometry).toMatchObject({ mode: 'explicit-empty', reason: 'Saved empty selection' });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('returns missing history honestly after a single empty page', async () => {
  const fetcher = vi.fn(async () => Response.json({ schemaVersion: 'wfc.pf.barrier-snapshot-list.v1', projectId: id(1), offset: 0, nextOffset: null, snapshots: [] }));
  vi.stubGlobal('fetch', fetcher); expect(await getLatestBarrierSnapshot(id(1), 'synthetic-token')).toBeNull(); expect(fetcher).toHaveBeenCalledOnce();
});
it.each(['project', 'reference-project', 'extra', 'offset', 'multiple'] as const)('refuses malformed or foreign %s history before reading any manifest', async kind => {
  const page = history(savedSnapshot());
  if (kind === 'project') page.projectId = id(99);
  if (kind === 'reference-project') page.snapshots[0].scope = { ...scope, projectId: id(99) };
  if (kind === 'extra') Object.assign(page, { current: true });
  if (kind === 'offset') page.offset = 1;
  if (kind === 'multiple') page.snapshots.push(structuredClone(page.snapshots[0]));
  const fetcher = vi.fn(async () => Response.json(page)); vi.stubGlobal('fetch', fetcher);
  await expect(getLatestBarrierSnapshot(id(1), 'synthetic-token')).rejects.toThrow(); expect(fetcher).toHaveBeenCalledOnce();
});
it.each(['revision', 'frame', 'mode', 'hash'] as const)('refuses saved manifest %s disagreement with the exact newest reference', async kind => {
  const snapshot = savedSnapshot(), page = history(snapshot);
  if (kind === 'revision') page.snapshots[0].registryRevision = '2';
  if (kind === 'frame') page.snapshots[0].scope = { ...scope, captureFrameId: id(99) };
  if (kind === 'mode') page.snapshots[0].mode = 'explicit-empty';
  if (kind === 'hash') snapshot.selectedParents[0].name = 'Tampered saved name';
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(page)).mockResolvedValueOnce(Response.json(snapshot)); vi.stubGlobal('fetch', fetcher);
  await expect(getLatestBarrierSnapshot(id(1), 'synthetic-token')).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(2);
});
it.each([401, 403])('stops a historical read on HTTP %s without trying a manifest or older page', async status => {
  const fetcher = vi.fn(async () => Response.json({ code: 'ADMIN_REQUIRED' }, { status })); vi.stubGlobal('fetch', fetcher);
  await expect(getLatestBarrierSnapshot(id(1), 'synthetic-token')).rejects.toMatchObject({ status }); expect(fetcher).toHaveBeenCalledOnce();
});
it('bounds history bytes and rejects duplicate JSON members', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('x'.repeat(BARRIER_LIMITS.manifestBytes + 1)))
    .mockResolvedValueOnce(new Response('{"projectId":"' + id(1) + '","projectId":"' + id(1) + '"}'));
  vi.stubGlobal('fetch', fetcher);
  await expect(getLatestBarrierSnapshot(id(1), 'synthetic-token')).rejects.toMatchObject({ code: 'BARRIER_RESPONSE_LIMIT' });
  await expect(getLatestBarrierSnapshot(id(1), 'synthetic-token')).rejects.toMatchObject({ code: 'BARRIER_RESPONSE_INVALID' });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('refuses an access-denied history response immediately even if its body never finishes', async () => {
  const cancel = vi.fn(), fetcher = vi.fn(async () => new Response(new ReadableStream({ cancel }), { status: 403 }));
  vi.stubGlobal('fetch', fetcher);
  await expect(getLatestBarrierSnapshot(id(1), 'synthetic-token')).rejects.toMatchObject({ status: 403, code: 'ADMIN_REQUIRED' });
  expect(fetcher).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalledOnce();
});
it('bounds the entire two-read history fallback when its manifest fetch ignores abort', async () => {
  vi.useFakeTimers(); const fetcher = vi.fn().mockResolvedValueOnce(Response.json(history(savedSnapshot()))).mockImplementationOnce(() => new Promise(() => {}));
  vi.stubGlobal('fetch', fetcher);
  const pending = expect(getLatestBarrierSnapshot(id(1), 'synthetic-token')).rejects.toMatchObject({ code: 'BARRIER_REQUEST_TIMEOUT' });
  await vi.advanceTimersByTimeAsync(BARRIER_READ_MILLISECONDS); await pending;
  expect(fetcher).toHaveBeenCalledTimes(2);
});
