import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { beginBarrierCapture, changeBarrierRegistry, getBarrierRegistry, getLatestBarrierSnapshot, getBarrierCaptureOutcome,
  getBarrierCommandRecovery, closeBarrierCommand, BARRIER_READ_MILLISECONDS } from './pathfinderBarriers';
import { BARRIER_LIMITS, barrierCanonicalJson, barrierSnapshotHashInput, barrierSnapshotSchema, type BarrierSnapshot } from '../../shared/pathfinderBarriers';
import { MIXED_BARRIER_POLICY, mixedBarrierCaptureCommandSchema, mixedBarrierSnapshotSchema } from '../../shared/pathfinderBarrierMixed';
import { supportedBarrierSnapshotReference, supportedBarrierSnapshotHashInput } from '../../shared/pathfinderBarrierSupported';
import { BARRIER_COMMAND_HASH_FENCE, BARRIER_RECOVERY_LIMITS, barrierCommandClosureHashInput, barrierCommandClosureSchema,
  barrierCommandRecoveryTargetHashInput, barrierCommandRecoveryTargetSchema } from '../../shared/pathfinderBarrierRecovery';
const id = (n: number) => `b2000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { projectId: id(1), modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), selectionRevision: '1',
  captureFrameId: id(3), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' as const };
const registry = { schemaVersion: 'wfc.pf.barrier-registry.v1', scope, registryRevision: '0', state: 'unconfigured',
  selectedParents: [], snapshot: null, reasonCodes: ['NO_BARRIER_SCOPE_CONFIGURED'] };
const recoveryTarget = () => barrierCommandRecoveryTargetSchema.parse({ schemaVersion: 'wfc.pf.barrier-command-recovery-target.v1',
  projectId: id(1), commandSha256: 'c'.repeat(64), scope, pendingRecordSha256: 'd'.repeat(64),
  pendingRecordVersion: 'wfc.pf.barrier-pending-command.v1', kind: 'capture-intent', knownIntent: null });
function recoveryHeader() {
  const target = recoveryTarget(); return { schemaVersion: 'wfc.pf.barrier-command-recovery.v1', pendingRecordSha256: target.pendingRecordSha256,
    targetSha256: createHash('sha256').update(barrierCanonicalJson(barrierCommandRecoveryTargetHashInput(target))).digest('hex') };
}
it('inspects the canonical exact saved target with current admin auth and a GET only', async () => {
  const target = recoveryTarget(), value = { ...recoveryHeader(), outcome: 'not-recorded' };
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(value)); vi.stubGlobal('fetch', fetcher);
  expect(await getBarrierCommandRecovery(id(1), 'new-current-admin-login', target)).toEqual(value);
  expect(fetcher).toHaveBeenCalledOnce(); const [url, options] = fetcher.mock.calls[0];
  expect(new URL(String(url), 'http://127.0.0.1').searchParams.get('target')).toBe(barrierCanonicalJson(target));
  expect(String(url)).toContain('/barriers/recovery/outcome?');
  expect(options).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error', credentials: 'same-origin', headers: { Authorization: 'Bearer new-current-admin-login' } });
  expect(options?.body).toBeUndefined(); expect(String(url)).not.toContain('new-current-admin-login');
});
it('submits only an explicit exact-hash Close command and decodes its strict immutable terminal', async () => {
  const target = recoveryTarget();
  const closure = barrierCommandClosureSchema.parse({ schemaVersion: 'wfc.pf.barrier-command-closure.v1', closureId: id(81), projectId: id(1),
    commandSha256: target.commandSha256, requestedCommand: { lane: 'legacy-v1', kind: 'capture', scope }, original: { state: 'not-recorded' },
    outcome: 'closed-not-published', fence: BARRIER_COMMAND_HASH_FENCE, closedBy: { authority: 'current-project-administrator-close-only', actorId: id(82), loginId: id(83) },
    closedAt: '2026-10-22T10:00:00.000Z', mayResumeCapture: false, mayPublish: false, establishesCurrentFrame: false, grantsCalculation: false, contentSha256: '0'.repeat(64) });
  closure.contentSha256 = createHash('sha256').update(barrierCanonicalJson(barrierCommandClosureHashInput(closure))).digest('hex');
  const value = { ...recoveryHeader(), outcome: 'closed', closure }, fetcher = vi.fn<typeof fetch>(async () => Response.json(value)); vi.stubGlobal('fetch', fetcher);
  expect(await closeBarrierCommand(id(1), 'current-admin', target)).toEqual(value);
  expect(fetcher).toHaveBeenCalledOnce(); const [url, options] = fetcher.mock.calls[0];
  expect(String(url)).toMatch(/\/barriers\/recovery\/close$/); expect(options?.method).toBe('POST');
  expect(JSON.parse(String(options?.body))).toEqual({ schemaVersion: 'wfc.pf.barrier-command-close.v1', target });
  expect(options?.body).not.toContain('idempotencyKey'); expect(options?.body).not.toContain('declare-empty');
});
it('rejects foreign projects and unsupported target fields before either recovery request', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  await expect(getBarrierCommandRecovery(id(99), 'current', recoveryTarget())).rejects.toMatchObject({ code: 'BARRIER_RECOVERY_PROJECT_CHANGED' });
  await expect(closeBarrierCommand(id(99), 'current', recoveryTarget())).rejects.toMatchObject({ code: 'BARRIER_RECOVERY_PROJECT_CHANGED' });
  const extra = { ...recoveryTarget(), resume: true };
  await expect(getBarrierCommandRecovery(id(1), 'current', extra)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
it('keeps null and missing recovery nonterminal while refusing malformed, over-budget and denied responses', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(null))
    .mockResolvedValueOnce(Response.json({ code: 'NOT_FOUND' }, { status: 404 }))
    .mockResolvedValueOnce(Response.json({ ...recoveryHeader(), outcome: 'not-recorded', ready: true }))
    .mockResolvedValueOnce(new Response(' '.repeat(BARRIER_RECOVERY_LIMITS.responseBytes + 1)))
    .mockResolvedValueOnce(Response.json({ code: 'ADMIN_REQUIRED' }, { status: 403 })); vi.stubGlobal('fetch', fetcher);
  expect(await getBarrierCommandRecovery(id(1), 'current', recoveryTarget())).toBeNull();
  await expect(getBarrierCommandRecovery(id(1), 'current', recoveryTarget())).rejects.toMatchObject({ status: 404 });
  await expect(getBarrierCommandRecovery(id(1), 'current', recoveryTarget())).rejects.toThrow();
  await expect(getBarrierCommandRecovery(id(1), 'current', recoveryTarget())).rejects.toMatchObject({ code: 'BARRIER_RESPONSE_LIMIT' });
  await expect(closeBarrierCommand(id(1), 'current', recoveryTarget())).rejects.toMatchObject({ status: 403 }); expect(fetcher).toHaveBeenCalledTimes(5);
});
it('reads exact historical capture outcome through authenticated GET without Viewer readiness or resubmission', async () => {
  const query = { commandSha256: 'a'.repeat(64), captureSha256: 'b'.repeat(64), frameSha256: 'c'.repeat(64) };
  const refusal = { schemaVersion: 'wfc.pf.barrier-publication-refusal.v1', outcome: 'not-published', intentId: id(7), ...query,
    implementationSha256: 'd'.repeat(64), reasonCode: 'BARRIER_GEOMETRY_REFUSED', duplicate: true };
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(refusal)); vi.stubGlobal('fetch', fetcher);
  expect(await getBarrierCaptureOutcome(id(1), 'current-auth', id(7), query)).toEqual(refusal);
  expect(fetcher).toHaveBeenCalledOnce(); expect(String(fetcher.mock.calls[0]?.[0])).toContain(`/barriers/intents/${id(7)}/outcome?commandSha256=`);
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { Authorization: 'Bearer current-auth' } });
});
it('keeps an unsettled null outcome distinct from publication or refusal and rejects invented terminal authority', async () => {
  const query = { commandSha256: 'a'.repeat(64), captureSha256: 'b'.repeat(64), frameSha256: 'c'.repeat(64) };
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(null)).mockResolvedValueOnce(Response.json({ outcome: 'not-published', ready: true })); vi.stubGlobal('fetch', fetcher);
  expect(await getBarrierCaptureOutcome(id(1), 'current-auth', id(7), query)).toBeNull();
  await expect(getBarrierCaptureOutcome(id(1), 'current-auth', id(7), query)).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(2);
});
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
it('reads an exact mixed newest manifest and refuses a legacy reference with the same empty mode', async () => {
  const old = savedSnapshot(true), value = mixedBarrierSnapshotSchema.parse({ ...old, schemaVersion: 'wfc.pf.barrier-snapshot.v2',
    geometryPolicy: MIXED_BARRIER_POLICY, ownTerminalExemptionsSupported: false, authority: 'none' });
  value.contentSha256 = createHash('sha256').update(barrierCanonicalJson(supportedBarrierSnapshotHashInput(value))).digest('hex');
  const page = { schemaVersion: 'wfc.pf.barrier-snapshot-list.v1', projectId: id(1), offset: 0, nextOffset: null, snapshots: [supportedBarrierSnapshotReference(value)] };
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(page)).mockResolvedValueOnce(Response.json(value)); vi.stubGlobal('fetch', fetcher);
  expect(await getLatestBarrierSnapshot(id(1), 'synthetic-token')).toEqual(value);
  const wrongPage = { ...page, snapshots: [{ snapshotId: value.snapshotId, scope: value.scope, registryRevision: value.registryRevision, contentSha256: value.contentSha256, mode: 'explicit-empty' }] };
  fetcher.mockResolvedValueOnce(Response.json(wrongPage)).mockResolvedValueOnce(Response.json(value));
  await expect(getLatestBarrierSnapshot(id(1), 'synthetic-token')).rejects.toMatchObject({ code: 'BARRIER_HISTORY_REFERENCE_CHANGED' });
});
it('requires a new exact mixed intent receipt while leaving the original submitted command unchanged', async () => {
  const command = mixedBarrierCaptureCommandSchema.parse({ schemaVersion: 'wfc.pf.barrier-capture-command.v2', geometryPolicy: MIXED_BARRIER_POLICY,
    scope, expectedRegistryRevision: '0', idempotencyKey: id(20), selectedParents: [{ selectionId: id(21), kind: 'floor', objectId: 'dbid:7', dbId: 7,
      externalId: null, name: 'Synthetic selected floor', identityBasis: 'version-local-only', inclusion: 'own-and-all-descendant-fragments' }] });
  const receipt = { schemaVersion: 'wfc.pf.barrier-intent-receipt.v2', state: 'pending', duplicate: false,
    intent: { id: id(22), snapshotId: id(23), captureBlobId: id(24), manifestBlobId: id(25), createdBy: id(26), loginId: id(27), command } };
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(receipt)).mockResolvedValueOnce(Response.json({ ...receipt, schemaVersion: 'wfc.pf.barrier-intent-receipt.v1' }));
  vi.stubGlobal('fetch', fetcher); const before = structuredClone(command);
  expect(await beginBarrierCapture(id(1), 'synthetic-token', command)).toEqual(receipt); expect(command).toEqual(before);
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual(command);
  await expect(beginBarrierCapture(id(1), 'synthetic-token', command)).rejects.toThrow();
});
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
