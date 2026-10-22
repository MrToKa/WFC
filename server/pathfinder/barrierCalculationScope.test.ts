// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { BARRIER_LIMITS, type BarrierCapture, type BarrierSnapshot } from '../../shared/pathfinderBarriers.js';
import { BARRIER_RUNTIME_PROFILE, verifyBarrierRuntimeContext } from '../../shared/pathfinderBarrierRuntime.js';
import { type BarrierAdmissionIntent } from '../../shared/pathfinderBarrierAdmission.js';
import { createHash } from 'node:crypto';
import { barrierBytesHash, barrierValueHash, encodeBarrierJson } from './barrierStorage.js';
import { collectBarrierCalculationScope, readCurrentBarrierAdmissionIntent } from './barrierCalculationScope.js';
import { MIXED_BARRIER_POLICY, MIXED_BARRIER_OPENING_RUNTIME_PROFILE, verifyMixedBarrierRuntimeContext } from '../../shared/pathfinderBarrierMixed.js';

const mocks = vi.hoisted(() => ({ scope: vi.fn(), read: vi.fn(), stat: vi.fn() }));
vi.mock('./barrierScope.js', () => ({ currentBarrierScope: mocks.scope }));
vi.mock('./storage.js', () => ({ pathFinderRoot: async () => 'C:/owned-barrier-calculation-fixture' }));
vi.mock('node:fs/promises', () => ({ default: { lstat: mocks.stat } }));
vi.mock('./barrierStorage.js', async original => ({ ...await original<typeof import('./barrierStorage.js')>(), readBarrierBytes: mocks.read }));
const id = (n: number) => `b6000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { projectId: id(1), modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), selectionRevision: '3',
  captureFrameId: id(3), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' as const };

/** Mock publication/storage boundary only. The tiny supplied triangle is not a
 * topology fixture; geometric qualification remains the independent B1 runner. */
function fixture(empty = false) {
  const parent = { selectionId: id(4), kind: 'wall' as const, objectId: 'dbid:7', dbId: 7, name: 'Synthetic selected parent', externalId: null,
    identityBasis: 'version-local-only' as const, inclusion: 'own-and-all-descendant-fragments' as const };
  const capture: BarrierCapture = { schemaVersion: 'wfc.pf.barrier-capture.v1', captureId: id(5), scope: structuredClone(scope), selectedParents: [parent],
    fragments: [{ source: { fragmentId: 8, ownerObjectId: 'dbid:7', parentSelectionIds: [parent.selectionId], sourceUnits: 'm', metresPerSourceUnit: 1,
      sourceToWorldMetres: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], transformSha256: 'c'.repeat(64) },
      bounds: { minimum: [0, 0, 0], maximum: [1, 1, 0] }, verticesMetres: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], triangleIndices: [0, 1, 2] }],
    observation: { state: 'reported-complete', verification: 'unverified', enumeratedFragmentIds: [8], unavailableFragmentIds: [], enumerationSha256: 'd'.repeat(64) } };
  const raw = Buffer.from(JSON.stringify(capture));
  const mesh = encodeBarrierJson({ verticesMetres: capture.fragments[0].verticesMetres, triangleIndices: capture.fragments[0].triangleIndices });
  const meshBlob = { blobId: id(10), sha256: barrierBytesHash(mesh), bytes: mesh.length };
  const body = { schemaVersion: 'wfc.pf.barrier-snapshot.v1' as const, snapshotId: id(6), scope: structuredClone(scope), registryRevision: '4',
    selectedParents: empty ? [] : [parent], capture: empty ? null : { captureId: id(5), payloadSha256: barrierBytesHash(raw) },
    geometry: empty ? { mode: 'explicit-empty' as const, declarationId: id(12), declaration: 'administrator-declared-no-selected-barriers' as const, reason: 'Synthetic empty declaration' }
      : { mode: 'mesh-set' as const, fragments: [{ source: capture.fragments[0].source, bounds: capture.fragments[0].bounds, mesh: meshBlob, vertices: 3, triangles: 1 }],
        verification: { producerVersion: 'wfc.pf.barrier-verifier.v1' as const, selectionClosure: 'complete-selected-scope' as const,
          topology: 'qualified-closed-consistent-two-manifold' as const, selfIntersection: 'bounded-verification-passed' as const,
          computationalMeshes: 1, verifiedCaptureSha256: barrierBytesHash(raw), verificationSha256: 'e'.repeat(64) } },
    coverage: 'registered-selected-objects-only' as const, engineeringAccepted: false as const };
  const manifest: BarrierSnapshot = { ...body, contentSha256: barrierValueHash(body) };
  const files = new Map([[id(9), raw], [id(10), mesh]]);
  const snapshot = { id: id(6), model_version_id: id(2), registry_revision: '4', storage_intent_id: id(5), manifest_blob: {} as unknown, manifest };
  const command = { schemaVersion: 'wfc.pf.barrier-capture-command.v1' as const, scope: structuredClone(scope), expectedRegistryRevision: '3', idempotencyKey: id(11), selectedParents: [parent] };
  const intentRow = { id: id(5), state: 'complete', actor_id: id(13), login_id: id(14), request_sha256: barrierValueHash(command), request: command,
    frozen: { id: id(5), snapshotId: id(6), captureBlobId: id(9), manifestBlobId: id(8), command, createdBy: id(13), loginId: id(14) },
    capture_sha256: barrierBytesHash(raw), allocation: [{ fragmentId: 8, blobId: id(10) }] };
  const intent: BarrierAdmissionIntent = { schemaVersion: 'wfc.pf.barrier-admission-intent.v1', scope: structuredClone(scope), expectedRegistryRevision: '4',
    expectedSnapshot: { snapshotId: id(6), scope: structuredClone(scope), registryRevision: '4', contentSha256: manifest.contentSha256, mode: manifest.geometry.mode }, drillThroughWalls: false };
  const state = { head: { revision: '4', snapshot_id: id(6) as string | null }, snapshot, intentRow };
  const refreshManifest = () => {
    const { contentSha256: _old, ...body } = snapshot.manifest; snapshot.manifest.contentSha256 = barrierValueHash(body);
    intent.expectedSnapshot!.contentSha256 = snapshot.manifest.contentSha256;
    const bytes = encodeBarrierJson(snapshot.manifest, BARRIER_LIMITS.manifestBytes); files.set(id(8), bytes);
    snapshot.manifest_blob = { blobId: id(8), sha256: barrierBytesHash(bytes), bytes: bytes.length };
  };
  const replaceRaw = (bytes: Buffer) => {
    files.set(id(9), bytes); intentRow.capture_sha256 = barrierBytesHash(bytes);
    if (snapshot.manifest.capture) snapshot.manifest.capture.payloadSha256 = intentRow.capture_sha256;
    if (snapshot.manifest.geometry.mode === 'mesh-set') snapshot.manifest.geometry.verification.verifiedCaptureSha256 = intentRow.capture_sha256;
    refreshManifest();
  };
  refreshManifest();
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('barrier:calculation-head')) return { rows: [state.head] };
    if (sql.includes('barrier:calculation-snapshot')) return { rows: [state.snapshot] };
    if (sql.includes('barrier:calculation-intent')) return { rows: [state.intentRow] };
    throw new Error('Unexpected reader SQL');
  });
  mocks.scope.mockResolvedValue(structuredClone(scope));
  mocks.stat.mockImplementation(async () => ({ isFile: () => true, isSymbolicLink: () => false, nlink: 1n, size: BigInt(files.get(id(9))!.length) }));
  mocks.read.mockImplementation(async (_project: string, _intent: string, blob: { blobId: string; sha256: string; bytes: number }) => {
    const value = files.get(blob.blobId);
    if (!value || value.length !== blob.bytes || barrierBytesHash(value) !== blob.sha256) throw Object.assign(new Error('Fixture blob integrity refusal'), { code: 'BARRIER_BLOB_INTEGRITY' });
    return Buffer.from(value);
  });
  return { state, intent, capture, files, query, client: { query } as unknown as PoolClient, refreshManifest, replaceRaw };
}
beforeEach(() => vi.clearAllMocks());

describe('transaction-owned barrier calculation input reader', () => {
  it('builds the exact new mixed profile only for a new mixed admission without mutating the old intent', async () => {
    const f = fixture(); f.state.head = { revision: '0', snapshot_id: null };
    const intent = { ...structuredClone(f.intent), schemaVersion: 'wfc.pf.barrier-admission-intent.v2' as const,
      geometryPolicy: MIXED_BARRIER_POLICY, expectedRegistryRevision: '0', expectedSnapshot: null, drillThroughWalls: true };
    const before = structuredClone(intent), value = await collectBarrierCalculationScope(f.client, id(1), intent);
    expect(value.profile).toEqual(MIXED_BARRIER_OPENING_RUNTIME_PROFILE);
    expect(value.profileSha256).toBe(barrierValueHash(MIXED_BARRIER_OPENING_RUNTIME_PROFILE));
    expect(verifyMixedBarrierRuntimeContext(value, text => createHash('sha256').update(text).digest('hex'))).toBe(true);
    expect(intent).toEqual(before); expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each([false, true])('derives a fresh no-drilling producer intent from a verified current publication (empty=%s)', async empty => {
    const f = fixture(empty), value = await readCurrentBarrierAdmissionIntent(f.client, id(1), false);
    expect(value).toEqual(f.intent); expect(value.drillThroughWalls).toBe(false);
    expect(mocks.read).toHaveBeenCalledTimes(empty ? 1 : 3);
  });
  it('never treats an unpublished registry as an empty producer scope or borrows a true drilling choice', async () => {
    const f = fixture(); f.state.head = { revision: '0', snapshot_id: null };
    await expect(readCurrentBarrierAdmissionIntent(f.client, id(1), false)).rejects.toMatchObject({ code: 'BARRIER_READY_SNAPSHOT_REQUIRED' });
    f.query.mockClear();
    await expect(readCurrentBarrierAdmissionIntent(f.client, id(1), true as false)).rejects.toMatchObject({ code: 'BARRIER_BACKGROUND_DRILLING_REFUSED' });
    expect(f.query).not.toHaveBeenCalled();
  });
  it('keeps stale prior publication metadata intact while refusing a producer intent with a typed scope error', async () => {
    const f = fixture(), original = structuredClone(f.state.snapshot);
    mocks.scope.mockResolvedValue({ ...scope, captureFrameId: id(99) });
    await expect(readCurrentBarrierAdmissionIntent(f.client, id(1), false)).rejects.toMatchObject({ code: 'BARRIER_CALCULATION_SCOPE_CHANGED' });
    expect(f.state.snapshot).toEqual(original); expect(mocks.read).not.toHaveBeenCalled();
  });
  it('does not return a producer intent when publication bytes are corrupt or its current scope changed', async () => {
    const f = fixture(); f.files.set(id(8), Buffer.from('corrupt'));
    await expect(readCurrentBarrierAdmissionIntent(f.client, id(1), false)).rejects.toMatchObject({ code: 'BARRIER_BLOB_INTEGRITY' });
    f.refreshManifest(); mocks.scope.mockReset().mockResolvedValueOnce(scope).mockResolvedValueOnce({ ...scope, selectionRevision: '5' });
    await expect(readCurrentBarrierAdmissionIntent(f.client, id(1), false)).rejects.toMatchObject({ code: 'BARRIER_CALCULATION_SCOPE_CHANGED' });
  });
  it('fences producer cancellation/deadline before reading any head or blob', async () => {
    const f = fixture(), aborted = new AbortController(); aborted.abort();
    await expect(readCurrentBarrierAdmissionIntent(f.client, id(1), false, { signal: aborted.signal })).rejects.toThrow();
    await expect(readCurrentBarrierAdmissionIntent(f.client, id(1), false, { deadline: Date.now() - 1 })).rejects.toMatchObject({ code: 'BARRIER_CALCULATION_DEADLINE' });
    expect(f.query).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });
  it('binds exact publication bytes/profile/policy without inlining geometry or caller paths', async () => {
    const f = fixture(), value = await collectBarrierCalculationScope(f.client, id(1), f.intent);
    expect(value.binding.snapshot).toEqual(f.intent.expectedSnapshot); expect(value.profile).toEqual(BARRIER_RUNTIME_PROFILE);
    expect(value.storage).toMatchObject({ intentId: id(5), capture: { blobId: id(9), sha256: f.state.intentRow.capture_sha256, bytes: f.files.get(id(9))!.length } });
    expect(verifyBarrierRuntimeContext(value, text => createHash('sha256').update(text).digest('hex'))).toBe(true);
    expect(JSON.stringify(value)).not.toMatch(/verticesMetres|triangleIndices|C:\//); expect(mocks.read).toHaveBeenCalledTimes(3);
    expect(mocks.scope).toHaveBeenCalledTimes(2); expect(f.query.mock.calls.every(([sql]) => !/INSERT|UPDATE|DELETE|BEGIN|COMMIT/.test(sql))).toBe(true);
  });
  it('admits an explicit unconfigured bypass without fabricating a stored snapshot', async () => {
    const f = fixture(); f.state.head = { revision: '0', snapshot_id: null }; f.intent.expectedRegistryRevision = '0'; f.intent.expectedSnapshot = null; f.intent.drillThroughWalls = true;
    expect(await collectBarrierCalculationScope(f.client, id(1), f.intent)).toMatchObject({ storage: null, binding: { snapshot: null, policy: { drillThroughWalls: true } } });
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.stat).not.toHaveBeenCalled();
  });
  it('retains explicit empty as a stored reasoned publication, distinct from bypass', async () => {
    const f = fixture(true), value = await collectBarrierCalculationScope(f.client, id(1), f.intent);
    expect(value.storage?.capture).toBeNull(); expect(value.binding.snapshot?.mode).toBe('explicit-empty'); expect(value.binding.policy.drillThroughWalls).toBe(false);
    expect(mocks.read).toHaveBeenCalledTimes(1); expect(mocks.stat).not.toHaveBeenCalled();
  });
  it.each(['project', 'revision', 'head', 'frame'] as const)('refuses changed %s authority before reading blobs', async change => {
    const f = fixture();
    if (change === 'project') f.intent.scope.projectId = id(88);
    if (change === 'revision') f.state.head.revision = '5';
    if (change === 'head') f.state.head.snapshot_id = id(88);
    if (change === 'frame') mocks.scope.mockResolvedValue({ ...scope, captureFrameId: id(88) });
    await expect(collectBarrierCalculationScope(f.client, id(1), f.intent)).rejects.toThrow(); expect(mocks.read).not.toHaveBeenCalled();
  });
  it('refuses a modified SQL manifest instead of trusting its unchanged content hash', async () => {
    const f = fixture(); f.state.snapshot.manifest.scope.contentFingerprint = 'f'.repeat(64);
    await expect(collectBarrierCalculationScope(f.client, id(1), f.intent)).rejects.toMatchObject({ code: 'BARRIER_CALCULATION_STORAGE_INVALID' });
  });
  it.each(['pending', 'actor', 'allocation', 'request'] as const)('refuses invalid completed capture %s provenance', async change => {
    const f = fixture();
    if (change === 'pending') f.state.intentRow.state = 'pending';
    if (change === 'actor') f.state.intentRow.actor_id = id(88);
    if (change === 'allocation') f.state.intentRow.allocation[0].blobId = id(88);
    if (change === 'request') f.state.intentRow.request_sha256 = 'f'.repeat(64);
    await expect(collectBarrierCalculationScope(f.client, id(1), f.intent)).rejects.toThrow();
  });
  it('refuses partial raw capture even when its retained SHA is internally consistent', async () => {
    const f = fixture(); f.capture.observation.state = 'partial'; f.replaceRaw(Buffer.from(JSON.stringify(f.capture)));
    await expect(collectBarrierCalculationScope(f.client, id(1), f.intent)).rejects.toMatchObject({ code: 'BARRIER_CALCULATION_STORAGE_INVALID' });
  });
  it('refuses duplicate raw JSON members rather than parsing them away', async () => {
    const f = fixture(); f.replaceRaw(Buffer.from(JSON.stringify(f.capture).replace('{', '{"captureId":"' + id(5) + '",')));
    await expect(collectBarrierCalculationScope(f.client, id(1), f.intent)).rejects.toMatchObject({ code: 'DUPLICATE_JSON_MEMBER' });
  });
  it('refuses corrupt mesh bytes through the existing independent storage boundary', async () => {
    const f = fixture(); f.files.set(id(10), Buffer.from('corrupt'));
    await expect(collectBarrierCalculationScope(f.client, id(1), f.intent)).rejects.toMatchObject({ code: 'BARRIER_BLOB_INTEGRITY' });
  });
  it.each(['manifest','capture-stat','capture-bytes','mesh'] as const)('normalizes only a missing retained %s file to typed unavailable currentness',async phase=>{
    const f=fixture(),missing=Object.assign(Error('Synthetic missing retained file'),{code:'ENOENT'});
    if(phase==='capture-stat')mocks.stat.mockRejectedValueOnce(missing);
    else {const skip=phase==='manifest'?0:phase==='capture-bytes'?1:2,read=mocks.read.getMockImplementation()!;
      for(let at=0;at<skip;at++)mocks.read.mockImplementationOnce(read);mocks.read.mockRejectedValueOnce(missing);}
    await expect(collectBarrierCalculationScope(f.client,id(1),f.intent)).rejects.toMatchObject({code:'BARRIER_CALCULATION_STORAGE_INVALID'});
  });
  it('does not convert access, programming or transport failures into missing-file currentness',async()=>{
    for(const code of ['EACCES','EIO',undefined]){const f=fixture(),error=Object.assign(Error('Synthetic refusal'),{code});mocks.read.mockRejectedValueOnce(error);
      await expect(collectBarrierCalculationScope(f.client,id(1),f.intent)).rejects.toBe(error);}
  });
  it('refuses a fresh scope change at the final authority reread', async () => {
    const f = fixture(); mocks.scope.mockResolvedValueOnce(scope).mockResolvedValueOnce({ ...scope, captureFrameSha256: 'f'.repeat(64) });
    await expect(collectBarrierCalculationScope(f.client, id(1), f.intent)).rejects.toMatchObject({ code: 'BARRIER_CALCULATION_SCOPE_CHANGED' });
  });
  it('checks cancellation and an expired admission deadline before issuing SQL or storage work', async () => {
    const f = fixture(), stopped = new AbortController(); stopped.abort();
    await expect(collectBarrierCalculationScope(f.client, id(1), f.intent, { signal: stopped.signal })).rejects.toThrow();
    await expect(collectBarrierCalculationScope(f.client, id(1), f.intent, { deadline: Date.now() - 1 })).rejects.toMatchObject({ code: 'BARRIER_CALCULATION_DEADLINE' });
    expect(f.query).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each([0n, BigInt(BARRIER_LIMITS.captureBytes) + 1n])('refuses invalid observed original-capture byte size %s', async size => {
    const f = fixture(); mocks.stat.mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false, nlink: 1n, size });
    await expect(collectBarrierCalculationScope(f.client, id(1), f.intent)).rejects.toMatchObject({ code: 'BARRIER_CALCULATION_STORAGE_INVALID' });
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });
});
