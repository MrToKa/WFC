import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import * as api from '@/api/pathfinderBarriers';
import { usePathfinderBarriers, type BarrierSelectedParent } from './usePathfinderBarriers';
import type { ProjectPreparationViewer } from './usePathFinder';
import type { AnyBarrierRegistry as BarrierRegistry, AnyBarrierSnapshot as BarrierSnapshot } from '../../../../shared/pathfinderBarrierSupported';
import { MIXED_BARRIER_POLICY } from '../../../../shared/pathfinderBarrierMixed';
import { supportedBarrierCaptureOutcomeSchema } from '../../../../shared/pathfinderBarrierSupported';
import type { ViewerSelection } from '../../../../viewer-runtime/protocol.mjs';
import { BARRIER_CAPTURE_ERROR_MESSAGES } from '../../../../viewer-runtime/barrier-capture-errors.mjs';
import { barrierCanonicalJson } from '../../../../shared/pathfinderBarriers';
import { BARRIER_PENDING_STORAGE_KEY, barrierPendingHash, createBarrierCommandSentinel, createPendingBarrierRecoveryTarget, readPendingBarrierCommand, retainPendingBarrierCommand, sealPendingBarrierCommand, type BarrierPendingCommand, type BarrierPendingPublication } from './barrierPendingPublication';
import { BARRIER_COMMAND_HASH_FENCE, barrierCommandClosureHashInput, barrierCommandClosureSchema,
  barrierCommandRecoveryResponseSchema, barrierCommandRecoveryTargetHashInput, type BarrierCommandRecoveryResponse } from '../../../../shared/pathfinderBarrierRecovery';

vi.mock('@/api/pathfinderBarriers', async original => ({ ...await original<typeof api>(), getBarrierRegistry: vi.fn(), getBarrierSnapshot: vi.fn(), getLatestBarrierSnapshot: vi.fn(), beginBarrierCapture: vi.fn(), changeBarrierRegistry: vi.fn(), getBarrierCaptureOutcome: vi.fn(), getBarrierCommandRecovery: vi.fn(), closeBarrierCommand: vi.fn() }));
const id = (n: number) => `b5000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { projectId: id(1), modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), selectionRevision: '1', captureFrameId: id(3), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' as const };
const parent = (n: number): BarrierSelectedParent => ({ selectionId: id(n + 1000), kind: 'wall', objectId: `dbid:${n}`, dbId: n, externalId: null, name: `Selected parent ${n}`, identityBasis: 'version-local-only', inclusion: 'own-and-all-descendant-fragments' });
function registry(parents: BarrierSelectedParent[] = [], revision = '1'): BarrierRegistry {
  return { schemaVersion: 'wfc.pf.barrier-registry.v1', scope: structuredClone(scope), registryRevision: revision, state: parents.length ? 'ready' : 'unconfigured', selectedParents: structuredClone(parents),
    snapshot: parents.length ? { snapshotId: id(10), scope: structuredClone(scope), registryRevision: revision, contentSha256: 'c'.repeat(64), mode: 'mesh-set' } : null, reasonCodes: parents.length ? [] : ['NO_BARRIER_SCOPE_CONFIGURED'] };
}
function mixedRegistry(parents: BarrierSelectedParent[], revision: string): BarrierRegistry {
  const value = registry(parents, revision);
  return { ...value, schemaVersion: 'wfc.pf.barrier-registry.v2', geometryPolicy: MIXED_BARRIER_POLICY,
    snapshot: value.snapshot ? { ...value.snapshot, schemaVersion: 'wfc.pf.barrier-snapshot-reference.v2', geometryPolicy: MIXED_BARRIER_POLICY, mode: 'mixed-mesh-set' } : null };
}
function manifest(value: BarrierRegistry, emptyReason = 'Reviewed empty scope'): BarrierSnapshot {
  if (value.schemaVersion === 'wfc.pf.barrier-registry.v2') {
    const ref = value.snapshot!;
    const legacy = manifest({ schemaVersion: 'wfc.pf.barrier-registry.v1', scope: value.scope, registryRevision: value.registryRevision,
      state: value.state, selectedParents: value.selectedParents, reasonCodes: value.reasonCodes,
      snapshot: { snapshotId: ref.snapshotId, scope: ref.scope, registryRevision: ref.registryRevision, contentSha256: ref.contentSha256, mode: ref.mode === 'mixed-mesh-set' ? 'mesh-set' : 'explicit-empty' } }, emptyReason);
    return { ...legacy, schemaVersion: 'wfc.pf.barrier-snapshot.v2', geometryPolicy: MIXED_BARRIER_POLICY, authority: 'none', ownTerminalExemptionsSupported: false,
      geometry: legacy.geometry.mode === 'explicit-empty' ? legacy.geometry : { mode: 'mixed-mesh-set', fragments: legacy.geometry.fragments,
        verification: { producerVersion: 'wfc.pf.barrier-mixed-verifier.v2', geometryPolicy: MIXED_BARRIER_POLICY, selectionClosure: 'complete-selected-scope',
          verifiedCaptureSha256: 'd'.repeat(64), originalGeometrySha256: 'e'.repeat(64), verificationSha256: 'a'.repeat(64), authority: 'none', engineeringAccepted: false,
          ownTerminalExemptionsSupported: false, componentMemberships: value.selectedParents.map((p, index) => ({ componentId: 'component:' + index,
            kind: 'original-surface', fragmentIds: [index], parentSelectionIds: [p.selectionId], triangleCount: 12, sourceMembershipSha256: 'f'.repeat(64) })) } } };
  }
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  if (value.snapshot!.mode === 'explicit-empty') return { schemaVersion: 'wfc.pf.barrier-snapshot.v1', snapshotId: value.snapshot!.snapshotId, scope: value.scope, registryRevision: value.registryRevision, contentSha256: value.snapshot!.contentSha256, selectedParents: [], capture: null,
    geometry: { mode: 'explicit-empty', declarationId: id(31), declaration: 'administrator-declared-no-selected-barriers', reason: emptyReason }, coverage: 'registered-selected-objects-only', engineeringAccepted: false };
  return { schemaVersion: 'wfc.pf.barrier-snapshot.v1', snapshotId: value.snapshot!.snapshotId, scope: value.scope, registryRevision: value.registryRevision, contentSha256: value.snapshot!.contentSha256, selectedParents: value.selectedParents,
    capture: { captureId: value.snapshot!.snapshotId === id(21) ? id(20) : id(11), payloadSha256: 'd'.repeat(64) }, geometry: { mode: 'mesh-set', fragments: value.selectedParents.map((p, index) => ({ source: { fragmentId: index, ownerObjectId: p.objectId, parentSelectionIds: [p.selectionId], sourceUnits: 'm', metresPerSourceUnit: 1, sourceToWorldMetres: matrix, transformSha256: 'e'.repeat(64) }, bounds: { minimum: [0, 0, 0], maximum: [1, 1, 1] }, mesh: { blobId: id(100 + index), sha256: 'f'.repeat(64), bytes: 256 }, vertices: 8, triangles: 12 })),
      verification: { producerVersion: 'wfc.pf.barrier-verifier.v1', selectionClosure: 'complete-selected-scope', topology: 'qualified-closed-consistent-two-manifold', selfIntersection: 'bounded-verification-passed', computationalMeshes: value.selectedParents.length, verifiedCaptureSha256: 'd'.repeat(64), verificationSha256: 'a'.repeat(64) } }, coverage: 'registered-selected-objects-only', engineeringAccepted: false };
}
function selection(...numbers: number[]): ViewerSelection {
  return { coordinateFrame: 'world-metres-z-up', metresPerDisplayUnit: 1, globalOffsetMetres: [0, 0, 0], objects: numbers.map(n => ({ objectId: n, parentId: n === 8 ? 7 : null, name: `Selected parent ${n}`, externalId: null, bounds: null, bottomCentre: null, derivation: 'display-aabb-bottom-centre', nativeVisibility: 'unknown', properties: [], propertiesTruncated: false })) };
}
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((done, refuse) => { resolve = done; reject = refuse; }); return { promise, resolve, reject }; }
type Options = Parameters<typeof usePathfinderBarriers>[0];
function fixture(initial: number[] = []) {
  let current = registry(initial.map(parent)); let lastRequest: Parameters<ProjectPreparationViewer['captureBarriers']>[0] | null = null; let currentEmptyReason = '';
  const readSelection = vi.fn().mockResolvedValue(selection(7));
  // These are protected-facade transport observations only. Geometry/topology is
  // not qualified by these hook fixtures; B1/B2 own that independent evidence.
  const observation = { capture: {}, frameObservation: { syntheticControlFixture: true } } as unknown as Awaited<ReturnType<ProjectPreparationViewer['captureBarriers']>>;
  const makeObservation = (request: Parameters<ProjectPreparationViewer['captureBarriers']>[0]) => {
    lastRequest = request; const parents = request.selectedParents.map(p => p.selectionId); const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    observation.capture = { schemaVersion: 'wfc.pf.barrier-capture.v1', captureId: request.captureId, scope: request.scope, selectedParents: request.selectedParents,
      fragments: [{ source: { fragmentId: 0, ownerObjectId: request.selectedParents[0].objectId, parentSelectionIds: parents, sourceUnits: 'm', metresPerSourceUnit: 1, sourceToWorldMetres: matrix, transformSha256: 'e'.repeat(64) }, bounds: { minimum: [0, 0, 0], maximum: [1, 1, 0] }, verticesMetres: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], triangleIndices: [0, 1, 2] }],
      observation: { state: 'reported-complete', verification: 'unverified', enumeratedFragmentIds: [0], unavailableFragmentIds: [], enumerationSha256: 'f'.repeat(64) } };
    const frame = { schemaVersion: 'wfc.pf.barrier-frame-observation.v1' as const, projectId: scope.projectId, modelVersionId: scope.modelVersionId,
      contentFingerprint: scope.contentFingerprint, loadId: id(900), sdkVersion: '7.130.0' as const, matrixPrecision: 'binary64' as const,
      coordinateFrame: 'canonical-world-metres' as const, sourceUnits: 'm', metresPerDisplayUnit: 1, upVector: [0, 0, 1] as [number, number, number],
      globalOffsetDisplayUnits: [0, 0, 0] as [number, number, number], globalOffsetMetres: [0, 0, 0] as [number, number, number],
      displayToWorldMetres: matrix, modelTransform: null, placementTransform: null };
    observation.frameObservation = { ...frame, contentSha256: createHash('sha256').update(barrierCanonicalJson(frame)).digest('hex') };
    return observation;
  };
  const captureBarriers = vi.fn(async (request: Parameters<ProjectPreparationViewer['captureBarriers']>[0]) => makeObservation(request));
  const publishBarriers = vi.fn<ProjectPreparationViewer['publishBarriers']>(async (intentId, publishedObservation) => {
    if (intentId !== id(20) || publishedObservation !== observation) throw new Error('Publisher received a different protected observation');
    if (!lastRequest) throw new Error('No protected capture was requested');
    current = mixedRegistry(lastRequest.selectedParents, String(Number(current.registryRevision) + 1));
    current.snapshot!.snapshotId = id(21);
    if (current.schemaVersion !== 'wfc.pf.barrier-registry.v2') throw Error('fixture');
    return { schemaVersion: 'wfc.pf.barrier-publication-receipt.v2' as const, snapshot: current.snapshot!, duplicate: false };
  });
  const publicationPreflight = vi.fn(async () => {});
  const appearance = { clear: vi.fn(), showPath: vi.fn(), showRoute: vi.fn(), applyTransparency: vi.fn(), restore: vi.fn() };
  const runProjectPreparation = vi.fn(async (_expected: unknown, operation: (viewer: ProjectPreparationViewer) => Promise<unknown>, signal?: AbortSignal) => {
    const assertCurrent = () => { if (signal?.aborted) throw new DOMException('Scope changed', 'AbortError'); };
    const publish: ProjectPreparationViewer['publishBarriers'] = async (intentId, value, onWriteStarted, expectedCommand) => {
      await publicationPreflight(); assertCurrent(); onWriteStarted?.(); return publishBarriers(intentId, value, undefined, expectedCommand);
    };
    assertCurrent(); const result = await operation({ assertCurrent, readSelection, captureBarriers, publishBarriers: publish, ...appearance } as unknown as ProjectPreparationViewer); assertCurrent(); return result;
  });
  const pf = { data: { activeModel: { modelVersionId: scope.modelVersionId, selectionRevision: '1', contentFingerprint: scope.contentFingerprint } }, viewerPhase: 'ready', preparationViewerGeneration: 1, busy: false, readSelection, runProjectPreparation, ...appearance } as unknown as Options['pf'];
  const options: Options = { projectId: scope.projectId, loadedProjectId: scope.projectId, token: 'synthetic-login', isAdmin: true, pf };
  vi.mocked(api.getBarrierRegistry).mockImplementation(async () => structuredClone(current));
  vi.mocked(api.getLatestBarrierSnapshot).mockResolvedValue(null);
  vi.mocked(api.getBarrierCommandRecovery).mockResolvedValue(null);
  vi.mocked(api.closeBarrierCommand).mockRejectedValue(Error('No synthetic close response configured'));
  vi.mocked(api.getBarrierSnapshot).mockImplementation(async () => manifest(current, currentEmptyReason));
  vi.mocked(api.beginBarrierCapture).mockImplementation(async (_project, _token, command) => {
    if (command.schemaVersion !== 'wfc.pf.barrier-capture-command.v2') throw Error('Expected a fresh mixed command');
    return { schemaVersion: 'wfc.pf.barrier-intent-receipt.v2', state: 'pending', duplicate: false,
      intent: { id: id(20), snapshotId: id(21), captureBlobId: id(22), manifestBlobId: id(23), command, createdBy: id(24), loginId: id(25) } };
  });
  vi.mocked(api.changeBarrierRegistry).mockImplementation(async (_project, _token, command) => {
    if (command.action === 'declare-empty') currentEmptyReason = command.reason;
    const snapshot = { schemaVersion: 'wfc.pf.barrier-snapshot-reference.v2' as const, geometryPolicy: MIXED_BARRIER_POLICY, snapshotId: id(30), scope: command.scope, registryRevision: String(Number(current.registryRevision) + 1), contentSha256: 'e'.repeat(64), mode: 'explicit-empty' as const };
    current = { ...current, schemaVersion: 'wfc.pf.barrier-registry.v2', geometryPolicy: MIXED_BARRIER_POLICY, registryRevision: snapshot.registryRevision, state: 'ready', selectedParents: [], snapshot, reasonCodes: [] };
    return { schemaVersion: 'wfc.pf.barrier-publication-receipt.v2', snapshot, duplicate: false };
  });
  return { options, pf, readSelection, runProjectPreparation, captureBarriers, publishBarriers, publicationPreflight, appearance, observation, makeObservation, getRegistry: () => current, setRegistry: (value: BarrierRegistry) => { current = value; } };
}
beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function mounted(f: ReturnType<typeof fixture>) {
  const view = renderHook((options: Options) => usePathfinderBarriers(options), { initialProps: f.options });
  await waitFor(() => expect(view.result.current.registry).not.toBeNull()); return view;
}
async function add(view: Awaited<ReturnType<typeof mounted>>) { await act(() => view.result.current.addSelection()); }
const frameUnavailable = () => Object.assign(new Error('Prepare the current frame'), { code: 'BARRIER_CURRENT_FRAME_UNAVAILABLE', status: 409 });
const preparedOptions = (options: Options, artifactId: number): Options => ({ ...options, pf: { ...options.pf,
  data: { ...options.pf.data!, artifacts: [{ id: id(artifactId), modelVersionId: scope.modelVersionId, snapshotSha256: '9'.repeat(64),
    objectCount: 1, engineeringAccepted: false, readiness: 'ready', capture: {}, coordinates: {}, createdAt: '2026-10-27T20:00:00Z' }] } } });
const refusal = (value: BarrierPendingPublication) => ({ schemaVersion: 'wfc.pf.barrier-publication-refusal.v1' as const, outcome: 'not-published' as const,
  intentId: value.intentId, commandSha256: value.commandSha256, captureSha256: value.captureSha256, frameSha256: value.frameSha256,
  implementationSha256: 'e'.repeat(64), reasonCode: 'BARRIER_GEOMETRY_REFUSED' as const, duplicate: false });

/** Synthetic protected API metadata only: these fixtures do not prove SQL,
 * authentication, geometry qualification or current calculation admission. */
async function recoveryResponse(value: BarrierPendingCommand, outcome: 'closed' | 'pending' | 'not-recorded' | 'geometry-refused' | 'published', publication?: unknown): Promise<BarrierCommandRecoveryResponse> {
  const target = await createPendingBarrierRecoveryTarget(value), mixed = value.schemaVersion === 'wfc.pf.barrier-pending-command.v2';
  const common = { schemaVersion: 'wfc.pf.barrier-command-recovery.v1', pendingRecordSha256: value.recordSha256,
    targetSha256: await barrierPendingHash(barrierCommandRecoveryTargetHashInput(target)) };
  const original = { commandSchemaVersion: mixed ? 'wfc.pf.barrier-capture-command.v2' : 'wfc.pf.barrier-capture-command.v1',
    ...(mixed ? { geometryPolicy: MIXED_BARRIER_POLICY } : {}), kind: 'capture', commandSha256: value.commandSha256, scope: value.scope,
    actorId: value.actorId ?? id(24), loginId: value.loginId ?? id(25), intentId: value.intentId ?? id(20), snapshotId: value.snapshotId ?? id(21),
    expectedRegistryRevision: '1', captureSha256: value.kind === 'publication' ? value.captureSha256 : null };
  if (outcome === 'not-recorded') return barrierCommandRecoveryResponseSchema.parse({ ...common, outcome });
  if (outcome === 'pending') return barrierCommandRecoveryResponseSchema.parse({ ...common, outcome, original });
  if (outcome === 'geometry-refused') {
    if (value.kind !== 'publication') throw Error('Refusal fixture requires publication');
    return barrierCommandRecoveryResponseSchema.parse({ ...common, outcome, original, refusal: refusal(value) });
  }
  if (outcome === 'published') return barrierCommandRecoveryResponseSchema.parse({ ...common, outcome, original, publication,
    frameBinding: 'not-recorded', frameSha256: null });
  const closure = barrierCommandClosureSchema.parse({ schemaVersion: 'wfc.pf.barrier-command-closure.v1', closureId: id(1500),
    projectId: value.projectId, commandSha256: value.commandSha256, requestedCommand: { lane: mixed ? 'mixed-v2' : 'legacy-v1',
      kind: value.kind === 'empty' ? 'declare-empty' : 'capture', scope: value.scope },
    original: value.kind !== 'empty' && value.actorId !== null ? { state: 'recorded', command: original } : { state: 'not-recorded' },
    outcome: 'closed-not-published', fence: BARRIER_COMMAND_HASH_FENCE, closedBy: { authority: 'current-project-administrator-close-only', actorId: id(1501), loginId: id(1502) },
    closedAt: '2026-10-22T10:00:00.000Z', mayResumeCapture: false, mayPublish: false, establishesCurrentFrame: false, grantsCalculation: false, contentSha256: '0'.repeat(64) });
  closure.contentSha256 = await barrierPendingHash(barrierCommandClosureHashInput(closure));
  return barrierCommandRecoveryResponseSchema.parse({ ...common, outcome, closure });
}

describe('durable exact barrier publication outcomes', () => {
  it('rejects a legacy success for a fresh mixed command and retains its exact policy through refresh recovery', async () => {
    const f = fixture([8]), view = await mounted(f); await add(view);
    const legacy = registry(view.result.current.draftParents, '2'); legacy.snapshot!.snapshotId = id(21);
    if (legacy.schemaVersion !== 'wfc.pf.barrier-registry.v1') throw Error('fixture');
    f.publishBarriers.mockResolvedValueOnce({ schemaVersion: 'wfc.pf.barrier-publication-receipt.v1', snapshot: legacy.snapshot!, duplicate: false });
    await act(() => view.result.current.save());
    expect(view.result.current.phase).toBe('unknown');
    const retained = await readPendingBarrierCommand(sessionStorage, scope.projectId);
    if (retained?.kind !== 'publication') throw Error('No retained publication');
    expect(retained.schemaVersion).toBe('wfc.pf.barrier-pending-command.v2');
    const command = vi.mocked(api.beginBarrierCapture).mock.calls[0]?.[2];
    expect(command).toMatchObject({ schemaVersion: 'wfc.pf.barrier-capture-command.v2', geometryPolicy: MIXED_BARRIER_POLICY });
    view.unmount();
    const restored = await mounted(f);
    const terminal = supportedBarrierCaptureOutcomeSchema.parse({ schemaVersion: 'wfc.pf.barrier-capture-outcome.v2', outcome: 'published',
      intentId: retained.intentId, commandSha256: retained.commandSha256, captureSha256: retained.captureSha256, frameBinding: 'not-recorded', frameSha256: null,
      publication: { schemaVersion: 'wfc.pf.barrier-publication-receipt.v2', duplicate: true,
        snapshot: { schemaVersion: 'wfc.pf.barrier-snapshot-reference.v2', geometryPolicy: MIXED_BARRIER_POLICY, snapshotId: retained.snapshotId,
          scope: retained.scope, registryRevision: '2', contentSha256: 'c'.repeat(64), mode: 'mixed-mesh-set' } } });
    if (!terminal || terminal.outcome !== 'published') throw Error('Published recovery fixture');
    vi.mocked(api.getBarrierCommandRecovery).mockResolvedValueOnce(await recoveryResponse(retained, 'published', terminal.publication));
    await act(() => restored.result.current.retry());
    expect(restored.result.current.pending).toBe(false); expect(await readPendingBarrierCommand(sessionStorage, scope.projectId)).toBeNull();
    expect(api.beginBarrierCapture).toHaveBeenCalledOnce(); expect(f.publishBarriers).toHaveBeenCalledOnce();
    expect(restored.result.current.message).toContain('actual published barrier set was refreshed');
  });
  it('prevents the PUT when its boundary cannot durably retain and read back the exact publication binding', async () => {
    const f = fixture(), view = await mounted(f); await add(view);
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === BARRIER_PENDING_STORAGE_KEY && JSON.parse(value).commands.some((item: { kind: string }) => item.kind === 'publication')) throw Error('quota');
      original.call(this, key, value);
    });
    await act(() => view.result.current.save());
    expect(api.beginBarrierCapture).toHaveBeenCalledOnce(); expect(f.captureBarriers).toHaveBeenCalledOnce(); expect(f.publishBarriers).not.toHaveBeenCalled();
    expect(view.result.current.phase).toBe('refused'); expect(view.result.current.pending).toBe(true);
  });
  it('settles a strict same-generation refusal and retains the previously published set', async () => {
    const f = fixture([8]), view = await mounted(f); await add(view); const previous = f.getRegistry().snapshot;
    const savedDraft = structuredClone(view.result.current.draftParents);
    f.publishBarriers.mockImplementationOnce(async () => {
      const retained = await readPendingBarrierCommand(sessionStorage, scope.projectId);
      if (retained?.kind !== 'publication') throw Error('Publication was not retained before PUT'); return refusal(retained);
    });
    await act(() => view.result.current.save());
    expect(view.result.current.phase).toBe('refused'); expect(view.result.current.pending).toBe(false);
    expect(view.result.current.registry?.snapshot).toEqual(previous); expect(await readPendingBarrierCommand(sessionStorage, scope.projectId)).toBeNull();
    expect(view.result.current.canAuthor).toBe(true); expect(view.result.current.draftParents).toEqual(savedDraft);
    const firstKey = vi.mocked(api.beginBarrierCapture).mock.calls[0]?.[2].idempotencyKey;
    act(() => { for (const selected of savedDraft) view.result.current.removeParent(selected.selectionId); view.result.current.setKind('floor'); });
    f.readSelection.mockResolvedValueOnce(selection(174115)); await add(view);
    expect(view.result.current.draftParents).toMatchObject([{ kind: 'floor', dbId: 174115 }]);
    await act(() => view.result.current.save());
    expect(api.beginBarrierCapture).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.beginBarrierCapture).mock.calls[1]?.[2].idempotencyKey).not.toBe(firstKey);
    expect(vi.mocked(api.beginBarrierCapture).mock.calls[1]?.[2].selectedParents).toMatchObject([{ kind: 'floor', dbId: 174115 }]);
    expect(api.changeBarrierRegistry).not.toHaveBeenCalled(); expect(api.getBarrierCaptureOutcome).not.toHaveBeenCalled();
    for (const action of Object.values(f.appearance)) expect(action).not.toHaveBeenCalled();
  });
  it('restores an unknown publication after reload and settles by exact GET while the Viewer is unavailable without re-PUT', async () => {
    const f = fixture(), first = await mounted(f); await add(first); f.publishBarriers.mockRejectedValueOnce(Error('lost acknowledgement'));
    await act(() => first.result.current.save()); const retained = await readPendingBarrierCommand(sessionStorage, scope.projectId);
    if (retained?.kind !== 'publication') throw Error('Missing retained fixture'); first.unmount();
    const changed = { ...f.options, pf: { ...f.pf, preparationViewerGeneration: 2, viewerPhase: 'loading' as const } };
    const second = renderHook(() => usePathfinderBarriers(changed)); await waitFor(() => expect(second.result.current.canRetry).toBe(true));
    vi.mocked(api.getBarrierCommandRecovery).mockResolvedValueOnce(null);
    await act(() => second.result.current.retry()); expect(second.result.current.phase).toBe('unknown'); expect(second.result.current.pending).toBe(true);
    vi.mocked(api.getBarrierCommandRecovery).mockResolvedValueOnce(await recoveryResponse(retained, 'geometry-refused'));
    await act(() => second.result.current.retry()); expect(second.result.current.pending).toBe(false); expect(second.result.current.registry).toEqual(f.getRegistry());
    expect(await readPendingBarrierCommand(sessionStorage, scope.projectId)).toBeNull(); expect(f.publishBarriers).toHaveBeenCalledOnce(); expect(api.beginBarrierCapture).toHaveBeenCalledOnce();
  });
  it('retains a restored original command when current authentication cannot read its exact outcome', async () => {
    const f = fixture(), first = await mounted(f); await add(first); f.publishBarriers.mockRejectedValueOnce(Error('lost acknowledgement'));
    await act(() => first.result.current.save()); first.unmount(); const stored = sessionStorage.getItem(BARRIER_PENDING_STORAGE_KEY);
    const changed = { ...f.options, token: 'different-current-token', pf: { ...f.pf, preparationViewerGeneration: 2, viewerPhase: 'error' as const } };
    const second = renderHook(() => usePathfinderBarriers(changed)); await waitFor(() => expect(second.result.current.canRetry).toBe(true));
    vi.mocked(api.getBarrierCommandRecovery).mockRejectedValueOnce(Object.assign(Error('Current administrator required'), { status: 403, code: 'ADMIN_REQUIRED' }));
    await act(() => second.result.current.retry()); expect(second.result.current.pending).toBe(true); expect(second.result.current.canRetry).toBe(false);
    expect(sessionStorage.getItem(BARRIER_PENDING_STORAGE_KEY)).toBe(stored); expect(f.publishBarriers).toHaveBeenCalledOnce(); expect(api.beginBarrierCapture).toHaveBeenCalledOnce();
    expect(vi.mocked(api.getBarrierCommandRecovery).mock.calls[0]?.[1]).toBe('different-current-token');
  });
  it('does not let a late outcome read from an earlier Viewer generation clear a retained command', async () => {
    const f = fixture(), first = await mounted(f); await add(first); f.publishBarriers.mockRejectedValueOnce(Error('lost acknowledgement'));
    await act(() => first.result.current.save()); const retained = await readPendingBarrierCommand(sessionStorage, scope.projectId);
    if (retained?.kind !== 'publication') throw Error('Missing retained fixture'); first.unmount();
    const changed: Options = { ...f.options, pf: { ...f.pf, preparationViewerGeneration: 2, viewerPhase: 'loading' } };
    const second = renderHook((options: Options) => usePathfinderBarriers(options), { initialProps: changed });
    await waitFor(() => expect(second.result.current.canRetry).toBe(true));
    const read = deferred<Awaited<ReturnType<typeof api.getBarrierCommandRecovery>>>(); vi.mocked(api.getBarrierCommandRecovery).mockReturnValueOnce(read.promise);
    let checking!: Promise<void>; act(() => { checking = second.result.current.retry(); });
    await waitFor(() => expect(api.getBarrierCommandRecovery).toHaveBeenCalledOnce());
    second.rerender({ ...changed, pf: { ...changed.pf, preparationViewerGeneration: 3 } });
    const terminal = await recoveryResponse(retained, 'geometry-refused');
    await act(async () => { read.resolve(terminal); await checking; });
    expect(await readPendingBarrierCommand(sessionStorage, scope.projectId)).toEqual(retained);
    expect(second.result.current.pending).toBe(true); expect(f.publishBarriers).toHaveBeenCalledOnce();
  });
  it('ignores an obsolete outcome denial without poisoning the new generation authentication latch', async () => {
    const f = fixture(), first = await mounted(f); await add(first); f.publishBarriers.mockRejectedValueOnce(Error('lost acknowledgement'));
    await act(() => first.result.current.save()); first.unmount(); const stored = sessionStorage.getItem(BARRIER_PENDING_STORAGE_KEY);
    const changed: Options = { ...f.options, pf: { ...f.pf, preparationViewerGeneration: 2, viewerPhase: 'loading' } };
    const second = renderHook((options: Options) => usePathfinderBarriers(options), { initialProps: changed });
    await waitFor(() => expect(second.result.current.canRetry).toBe(true));
    const read = deferred<Awaited<ReturnType<typeof api.getBarrierCommandRecovery>>>(); vi.mocked(api.getBarrierCommandRecovery).mockReturnValueOnce(read.promise);
    let checking!: Promise<void>; act(() => { checking = second.result.current.retry(); });
    await waitFor(() => expect(api.getBarrierCommandRecovery).toHaveBeenCalledOnce());
    second.rerender({ ...changed, pf: { ...changed.pf, preparationViewerGeneration: 3 } });
    await waitFor(() => expect(second.result.current.canRetry).toBe(true));
    await act(async () => { read.reject(Object.assign(Error('Old auth denial'), { status: 403 })); await checking; });
    expect(second.result.current.pending).toBe(true); expect(second.result.current.canRetry).toBe(true);
    expect(sessionStorage.getItem(BARRIER_PENDING_STORAGE_KEY)).toBe(stored);
  });
  it('ignores an obsolete POST refusal before touching either project retained command or the new project auth latch', async () => {
    const f = fixture(), view = await mounted(f); await add(view);
    const otherProject = id(901), otherScope = { ...scope, projectId: otherProject };
    const sentinel = await createBarrierCommandSentinel('capture-intent', { schemaVersion: 'wfc.pf.barrier-capture-command.v1',
      scope: otherScope, expectedRegistryRevision: '1', idempotencyKey: id(907), selectedParents: [parent(7)] }, otherScope, 'other-token');
    const other = await sealPendingBarrierCommand({ ...sentinel, kind: 'publication', actorId: id(902), loginId: id(903), intentId: id(904), snapshotId: id(905),
      captureSha256: 'a'.repeat(64), frameSha256: 'b'.repeat(64), loadId: id(906) });
    retainPendingBarrierCommand(sessionStorage, other, null);
    const write = deferred<Awaited<ReturnType<typeof api.beginBarrierCapture>>>(); vi.mocked(api.beginBarrierCapture).mockReturnValueOnce(write.promise);
    let saving!: Promise<void>; act(() => { saving = view.result.current.save(); });
    await waitFor(() => expect(api.beginBarrierCapture).toHaveBeenCalledOnce()); const stored = sessionStorage.getItem(BARRIER_PENDING_STORAGE_KEY);
    view.rerender({ ...f.options, projectId: otherProject, loadedProjectId: otherProject, token: 'other-token', pf: { ...f.pf, preparationViewerGeneration: 2, viewerPhase: 'loading' } });
    await waitFor(() => expect(view.result.current.canRetry).toBe(true));
    await act(async () => { write.reject(Object.assign(Error('Old POST denial'), { status: 403 })); await saving; });
    expect(view.result.current.pending).toBe(true); expect(view.result.current.canRetry).toBe(true);
    expect(sessionStorage.getItem(BARRIER_PENDING_STORAGE_KEY)).toBe(stored);
    expect(await readPendingBarrierCommand(sessionStorage, otherProject)).toEqual(other);
  });
  it.each(['capture-intent', 'empty'] as const)('inspects an unresolved %s sentinel across reload without replay and keeps null nonterminal', async kind => {
    const f = fixture(), first = await mounted(f);
    if (kind === 'capture-intent') { await add(first); vi.mocked(api.beginBarrierCapture).mockRejectedValueOnce(Error('lost intent acknowledgement')); }
    else { act(() => first.result.current.setEmptyReason('Reviewed synthetic empty scope')); vi.mocked(api.changeBarrierRegistry).mockRejectedValueOnce(Error('lost empty acknowledgement')); }
    await act(() => first.result.current.save()); const retained = await readPendingBarrierCommand(sessionStorage, scope.projectId);
    expect(retained?.kind).toBe(kind); first.unmount();
    const second = renderHook(() => usePathfinderBarriers({ ...f.options, pf: { ...f.pf, preparationViewerGeneration: 2, viewerPhase: 'loading' } }));
    await waitFor(() => expect(second.result.current.phase).toBe('unknown'));
    expect(second.result.current.pending).toBe(true); expect(second.result.current.canRetry).toBe(true); expect(second.result.current.canInspect).toBe(true);
    await act(() => second.result.current.retry()); await act(() => second.result.current.save());
    expect(api.getBarrierCommandRecovery).toHaveBeenCalledOnce(); expect(api.getBarrierCaptureOutcome).not.toHaveBeenCalled(); expect(await readPendingBarrierCommand(sessionStorage, scope.projectId)).toEqual(retained);
    expect(api.beginBarrierCapture).toHaveBeenCalledTimes(kind === 'capture-intent' ? 1 : 0);
    expect(api.changeBarrierRegistry).toHaveBeenCalledTimes(kind === 'empty' ? 1 : 0);
  });
  it('closes an acknowledged failed capture, preserves its changed selection, then saves a fresh command and reports actual ready state', async () => {
    const f = fixture([8]), view = await mounted(f); await add(view); const originalPublished = f.getRegistry().snapshot;
    f.captureBarriers.mockRejectedValueOnce(Object.assign(Error('Capture failed'), { code: 'EXTRACTION_FAILED' }));
    await act(() => view.result.current.save());
    const retained = await readPendingBarrierCommand(sessionStorage, scope.projectId);
    if (retained?.kind !== 'capture-intent' || retained.intentId === null) throw Error('Expected acknowledged capture fixture');
    const draft = structuredClone(view.result.current.draftParents), firstCommand = vi.mocked(api.beginBarrierCapture).mock.calls[0][2];
    expect(view.result.current.phase).toBe('refused'); expect(view.result.current.canClose).toBe(true);
    const terminal = await recoveryResponse(retained, 'closed');
    vi.mocked(api.closeBarrierCommand).mockImplementationOnce(async () => {
      expect(await readPendingBarrierCommand(sessionStorage, scope.projectId)).toEqual(retained); return terminal;
    });
    await act(() => view.result.current.close());
    expect(view.result.current.pending).toBe(false); expect(view.result.current.registry?.snapshot).toEqual(originalPublished);
    expect(view.result.current.draftParents).toEqual(draft); expect(view.result.current.dirty).toBe(true); expect(view.result.current.canAuthor).toBe(true); expect(view.result.current.canDiscard).toBe(true);
    expect(f.publishBarriers).not.toHaveBeenCalled(); expect(api.changeBarrierRegistry).not.toHaveBeenCalled();
    act(() => { for (const value of draft) view.result.current.removeParent(value.selectionId); view.result.current.setKind('floor'); });
    f.readSelection.mockResolvedValueOnce(selection(174115)); await add(view);
    await act(() => view.result.current.save());
    const nextCommand = vi.mocked(api.beginBarrierCapture).mock.calls[1][2];
    expect(nextCommand.idempotencyKey).not.toBe(firstCommand.idempotencyKey);
    expect(nextCommand.selectedParents).toMatchObject([{ kind: 'floor', dbId: 174115 }]);
    expect(view.result.current.registry?.state).toBe('ready'); expect(view.result.current.pending).toBe(false); expect(view.result.current.dirty).toBe(false);
    expect(await readPendingBarrierCommand(sessionStorage, scope.projectId)).toBeNull(); expect(f.publishBarriers).toHaveBeenCalledOnce();
    // Common calculation controls receive this actual registry/dirty/pending
    // state. This hook fixture does not execute the calculation engine itself.
  });
  it.each(['capture-intent', 'empty'] as const)('lets a different current admin close an unknown %s after reload without rebinding the original token or replaying', async kind => {
    const f = fixture(), first = await mounted(f);
    if (kind === 'capture-intent') { await add(first); vi.mocked(api.beginBarrierCapture).mockRejectedValueOnce(Error('lost begin ACK')); }
    else { act(() => first.result.current.setEmptyReason('Synthetic reviewed scope')); vi.mocked(api.changeBarrierRegistry).mockRejectedValueOnce(Error('lost empty ACK')); }
    await act(() => first.result.current.save()); const retained = await readPendingBarrierCommand(sessionStorage, scope.projectId);
    if (!retained) throw Error('Missing saved command'); first.unmount();
    const terminal = await recoveryResponse(retained, 'closed');
    const second = renderHook(() => usePathfinderBarriers({ ...f.options, token: 'different-current-admin', pf: { ...f.pf, preparationViewerGeneration: 2, viewerPhase: 'error' } }));
    await waitFor(() => expect(second.result.current.canClose).toBe(true));
    const beforeNative = f.runProjectPreparation.mock.calls.length;
    vi.mocked(api.closeBarrierCommand).mockImplementationOnce(async (project, token, target) => {
      expect(project).toBe(scope.projectId); expect(token).toBe('different-current-admin');
      expect(target).toEqual(await createPendingBarrierRecoveryTarget(retained));
      expect(await readPendingBarrierCommand(sessionStorage, scope.projectId)).toEqual(retained); return terminal;
    });
    await act(() => second.result.current.close());
    expect(second.result.current.pending).toBe(false); expect(second.result.current.registry).toEqual(f.getRegistry());
    expect(second.result.current.canAuthor).toBe(false); // A broken Viewer does not gain authoring authority.
    expect(await readPendingBarrierCommand(sessionStorage, scope.projectId)).toBeNull();
    expect(f.runProjectPreparation).toHaveBeenCalledTimes(beforeNative); expect(f.captureBarriers).not.toHaveBeenCalled(); expect(f.publishBarriers).not.toHaveBeenCalled();
    expect(api.beginBarrierCapture).toHaveBeenCalledTimes(kind === 'capture-intent' ? 1 : 0); expect(api.changeBarrierRegistry).toHaveBeenCalledTimes(kind === 'empty' ? 1 : 0);
  });
  it('retains a lost in-memory Close acknowledgement and Retry uses exact GET without repeating Close or the original POST/PUT', async () => {
    const f = fixture([8]), view = await mounted(f); await add(view); f.publishBarriers.mockRejectedValueOnce(Error('lost PUT ACK'));
    await act(() => view.result.current.save()); const retained = await readPendingBarrierCommand(sessionStorage, scope.projectId);
    if (!retained) throw Error('Missing saved command');
    vi.mocked(api.closeBarrierCommand).mockRejectedValueOnce(Error('lost Close ACK'));
    await act(() => view.result.current.close());
    expect(view.result.current.phase).toBe('unknown'); expect(await readPendingBarrierCommand(sessionStorage, scope.projectId)).toEqual(retained);
    vi.mocked(api.getBarrierCommandRecovery).mockResolvedValueOnce(await recoveryResponse(retained, 'closed'));
    await act(() => view.result.current.retry());
    expect(view.result.current.pending).toBe(false); expect(view.result.current.registry?.state).toBe('ready');
    expect(api.closeBarrierCommand).toHaveBeenCalledOnce(); expect(api.getBarrierCommandRecovery).toHaveBeenCalledOnce();
    expect(api.beginBarrierCapture).toHaveBeenCalledOnce(); expect(f.captureBarriers).toHaveBeenCalledOnce(); expect(f.publishBarriers).toHaveBeenCalledOnce();
  });
  it('holds the exact record and current admission until the terminal outcome is followed by a complete real registry/manifest refresh', async () => {
    const f = fixture([8]), view = await mounted(f); await add(view); f.publishBarriers.mockRejectedValueOnce(Error('lost PUT ACK'));
    await act(() => view.result.current.save()); const retained = await readPendingBarrierCommand(sessionStorage, scope.projectId);
    if (!retained) throw Error('Missing saved command');
    vi.mocked(api.getBarrierCommandRecovery).mockResolvedValueOnce(await recoveryResponse(retained, 'closed'));
    const registryRead = deferred<BarrierRegistry>(); vi.mocked(api.getBarrierRegistry).mockReturnValueOnce(registryRead.promise);
    let checking!: Promise<void>; act(() => { checking = view.result.current.inspect(); });
    await waitFor(() => expect(view.result.current.message).toContain('Refreshing the actual published barrier set'));
    expect(view.result.current.registry).toBeNull(); expect(view.result.current.manifest).toBeNull(); expect(view.result.current.pending).toBe(true);
    expect(await readPendingBarrierCommand(sessionStorage, scope.projectId)).toEqual(retained);
    await act(async () => { registryRead.resolve(structuredClone(f.getRegistry())); await checking; });
    expect(view.result.current.pending).toBe(false); expect(view.result.current.registry).toEqual(f.getRegistry());
    expect(view.result.current.saved?.status).toBe('current'); expect(await readPendingBarrierCommand(sessionStorage, scope.projectId)).toBeNull();
  });
  it('keeps an in-memory confirmed terminal locked after refresh failure and Retry performs GET-only until a successful refresh', async () => {
    const f = fixture([8]), view = await mounted(f); await add(view);
    // This known local capture failed before PUT: only the later exact terminal
    // makes it recovery-only; ordinary preflight/capture retry is unchanged.
    f.captureBarriers.mockRejectedValueOnce(Object.assign(Error('Capture failed'), { code: 'EXTRACTION_FAILED' }));
    await act(() => view.result.current.save()); const retained = await readPendingBarrierCommand(sessionStorage, scope.projectId);
    if (!retained) throw Error('Missing saved command');
    const terminal = await recoveryResponse(retained, 'closed'); vi.mocked(api.getBarrierCommandRecovery).mockResolvedValue(terminal);
    vi.mocked(api.getBarrierRegistry).mockRejectedValueOnce(Error('Refresh unavailable'));
    await act(() => view.result.current.inspect());
    expect(view.result.current.pending).toBe(true); expect(view.result.current.registry).toBeNull(); expect(view.result.current.canAuthor).toBe(false);
    expect(view.result.current.canDiscard).toBe(false);
    expect(view.result.current.message).toContain('saved recovery record remains locked'); expect(await readPendingBarrierCommand(sessionStorage, scope.projectId)).toEqual(retained);
    act(() => view.result.current.discardPending());
    expect(view.result.current.pending).toBe(true); expect(await readPendingBarrierCommand(sessionStorage, scope.projectId)).toEqual(retained);
    await act(() => view.result.current.retry()); expect(view.result.current.pending).toBe(false);
    expect(view.result.current.registry).toEqual(f.getRegistry()); expect(api.closeBarrierCommand).not.toHaveBeenCalled();
    expect(api.getBarrierCommandRecovery).toHaveBeenCalledTimes(2); expect(api.beginBarrierCapture).toHaveBeenCalledOnce();
    expect(f.captureBarriers).toHaveBeenCalledOnce(); expect(f.publishBarriers).not.toHaveBeenCalled();
  });
  it.each(['not-recorded', 'pending', 'missing'] as const)('keeps %s inspection nonterminal and never turns it into a new declaration', async outcome => {
    const f = fixture(), view = await mounted(f); await add(view); vi.mocked(api.beginBarrierCapture).mockRejectedValueOnce(Error('lost begin ACK'));
    await act(() => view.result.current.save()); const retained = await readPendingBarrierCommand(sessionStorage, scope.projectId);
    if (!retained) throw Error('Missing saved command');
    if (outcome === 'missing') vi.mocked(api.getBarrierCommandRecovery).mockRejectedValueOnce(Object.assign(Error('Missing'), { status: 404 }));
    else vi.mocked(api.getBarrierCommandRecovery).mockResolvedValueOnce(await recoveryResponse(retained, outcome));
    await act(() => view.result.current.inspect());
    expect(view.result.current.pending).toBe(true); expect(await readPendingBarrierCommand(sessionStorage, scope.projectId)).toEqual(retained);
    expect(api.beginBarrierCapture).toHaveBeenCalledOnce(); expect(api.changeBarrierRegistry).not.toHaveBeenCalled(); expect(api.closeBarrierCommand).not.toHaveBeenCalled();
  });
  it('prevents Close dispatch if write-ahead storage cannot confirm the same original record', async () => {
    const f = fixture(), view = await mounted(f); await add(view); vi.mocked(api.beginBarrierCapture).mockRejectedValueOnce(Error('lost begin ACK'));
    await act(() => view.result.current.save()); const stored = sessionStorage.getItem(BARRIER_PENDING_STORAGE_KEY);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('quota'); });
    await act(() => view.result.current.close()); expect(api.closeBarrierCommand).not.toHaveBeenCalled();
    expect(view.result.current.pending).toBe(true); expect(sessionStorage.getItem(BARRIER_PENDING_STORAGE_KEY)).toBe(stored);
  });
  it('does not delete a changed persisted record after an otherwise valid terminal response', async () => {
    const f = fixture(), view = await mounted(f); await add(view); vi.mocked(api.beginBarrierCapture).mockRejectedValueOnce(Error('lost begin ACK'));
    await act(() => view.result.current.save()); const retained = await readPendingBarrierCommand(sessionStorage, scope.projectId);
    if (!retained) throw Error('Missing saved command');
    const changed = await sealPendingBarrierCommand({ ...retained, createdAt: '2026-10-22T11:00:00.000Z' });
    const read = deferred<Awaited<ReturnType<typeof api.getBarrierCommandRecovery>>>(); vi.mocked(api.getBarrierCommandRecovery).mockReturnValueOnce(read.promise);
    let checking!: Promise<void>; act(() => { checking = view.result.current.inspect(); });
    await waitFor(() => expect(api.getBarrierCommandRecovery).toHaveBeenCalledOnce());
    sessionStorage.setItem(BARRIER_PENDING_STORAGE_KEY, JSON.stringify({ version: 1, commands: [changed] }));
    const terminal = await recoveryResponse(retained, 'closed'); await act(async () => { read.resolve(terminal); await checking; });
    expect(view.result.current.pending).toBe(true); expect(await readPendingBarrierCommand(sessionStorage, scope.projectId)).toEqual(changed);
  });
  it('ignores a late Close terminal after an auth epoch change and preserves the new context saved record', async () => {
    const f = fixture(), view = await mounted(f); await add(view); vi.mocked(api.beginBarrierCapture).mockRejectedValueOnce(Error('lost begin ACK'));
    await act(() => view.result.current.save()); const retained = await readPendingBarrierCommand(sessionStorage, scope.projectId);
    if (!retained) throw Error('Missing saved command');
    const write = deferred<Awaited<ReturnType<typeof api.closeBarrierCommand>>>(); vi.mocked(api.closeBarrierCommand).mockReturnValueOnce(write.promise);
    let closing!: Promise<void>; act(() => { closing = view.result.current.close(); });
    await waitFor(() => expect(api.closeBarrierCommand).toHaveBeenCalledOnce());
    view.rerender({ ...f.options, token: 'new-current-admin', pf: { ...f.pf, viewerPhase: 'error', preparationViewerGeneration: 2 } });
    await waitFor(() => expect(view.result.current.canInspect).toBe(true)); const terminal = await recoveryResponse(retained, 'closed');
    await act(async () => { write.resolve(terminal); await closing; });
    expect(view.result.current.pending).toBe(true); expect(view.result.current.canInspect).toBe(true);
    expect(await readPendingBarrierCommand(sessionStorage, scope.projectId)).toEqual(retained);
  });
});

describe('saved barrier selection persistence and historical display', () => {
  it('restores a published set on remount and Viewer generation change without any capture or write', async () => {
    const f = fixture([7]), first = await mounted(f);
    expect(first.result.current.saved).toMatchObject({ status: 'current', manifest: { selectedParents: [parent(7)] } });
    first.unmount(); const second = await mounted(f);
    expect(second.result.current.draftParents).toEqual([parent(7)]);
    second.rerender({ ...f.options, pf: { ...f.pf, preparationViewerGeneration: 2 } });
    await waitFor(() => expect(second.result.current.saved?.status).toBe('current'));
    expect(second.result.current.saved?.manifest.selectedParents).toEqual([parent(7)]);
    expect(api.beginBarrierCapture).not.toHaveBeenCalled(); expect(api.changeBarrierRegistry).not.toHaveBeenCalled(); expect(f.captureBarriers).not.toHaveBeenCalled();
  });
  it('keeps Add-only changes distinct from saved publication and does not pretend they survive remount', async () => {
    const f = fixture(), first = await mounted(f); await add(first);
    expect(first.result.current.dirty).toBe(true); expect(first.result.current.saved).toBeNull(); first.unmount();
    const second = await mounted(f); expect(second.result.current.draftParents).toEqual([]); expect(second.result.current.saved).toBeNull();
    expect(api.beginBarrierCapture).not.toHaveBeenCalled(); expect(api.changeBarrierRegistry).not.toHaveBeenCalled();
  });
  it('shows stale saved names separately and never seeds a current capture from their old object IDs', async () => {
    const f = fixture([7]), published = manifest(f.getRegistry());
    f.setRegistry({ ...f.getRegistry(), scope: { ...scope, captureFrameId: id(900) }, state: 'stale', reasonCodes: ['BARRIER_MODEL_SCOPE_CHANGED'] });
    vi.mocked(api.getBarrierSnapshot).mockResolvedValue(published);
    const view = await mounted(f);
    expect(view.result.current.saved).toEqual({ manifest: published, status: 'recapture-required' });
    expect(view.result.current.draftParents).toEqual([]); expect(view.result.current.dirty).toBe(false);
    await act(() => view.result.current.save()); expect(api.changeBarrierRegistry).not.toHaveBeenCalled();
    f.readSelection.mockResolvedValue(selection(8)); await add(view);
    expect(view.result.current.draftParents.map(value => value.dbId)).toEqual([8]);
    expect(view.result.current.saved?.manifest.selectedParents.map(value => value.dbId)).toEqual([7]);
    expect(f.runProjectPreparation).toHaveBeenCalledWith(expect.objectContaining({ captureFrameId: id(900) }), expect.any(Function), expect.any(AbortSignal));
    expect(api.beginBarrierCapture).not.toHaveBeenCalled();
  });
  it('withholds current ready admission during and after a failed refresh but retains last verified names', async () => {
    const f = fixture([7]), view = await mounted(f), read = deferred<BarrierRegistry>();
    vi.mocked(api.getBarrierRegistry).mockReturnValueOnce(read.promise);
    let refreshing!: Promise<void>; act(() => { refreshing = view.result.current.refresh(); });
    expect(view.result.current.registry).toBeNull(); expect(view.result.current.saved?.status).toBe('unavailable'); expect(view.result.current.canAuthor).toBe(false);
    await act(async () => { read.reject(new Error('Temporary read failure')); await refreshing; });
    expect(view.result.current.registry).toBeNull(); expect(view.result.current.manifest).toBeNull();
    expect(view.result.current.saved?.manifest.selectedParents).toEqual([parent(7)]); expect(api.getLatestBarrierSnapshot).not.toHaveBeenCalled();
    await act(() => view.result.current.save()); expect(api.beginBarrierCapture).not.toHaveBeenCalled();
  });
  it('uses one historical fallback for a cold missing frame, with saved names display-only and no current draft', async () => {
    const f = fixture([7]), published = manifest(f.getRegistry());
    vi.mocked(api.getBarrierRegistry).mockRejectedValueOnce(frameUnavailable()); vi.mocked(api.getLatestBarrierSnapshot).mockResolvedValueOnce(published);
    const view = renderHook(() => usePathfinderBarriers(f.options));
    await waitFor(() => expect(view.result.current.saved).toEqual({ manifest: published, status: 'unavailable' }));
    expect(api.getLatestBarrierSnapshot).toHaveBeenCalledExactlyOnceWith(id(1), 'synthetic-login', expect.any(AbortSignal));
    expect(view.result.current.registry).toBeNull(); expect(view.result.current.draftParents).toEqual([]); expect(view.result.current.canAuthor).toBe(false);
    await act(() => view.result.current.addSelection()); await act(() => view.result.current.save());
    expect(f.runProjectPreparation).not.toHaveBeenCalled(); expect(api.beginBarrierCapture).not.toHaveBeenCalled(); expect(api.changeBarrierRegistry).not.toHaveBeenCalled();
  });
  it('reports empty saved history without creating an empty declaration', async () => {
    const f = fixture(); vi.mocked(api.getBarrierRegistry).mockRejectedValueOnce(frameUnavailable());
    const view = renderHook(() => usePathfinderBarriers(f.options));
    await waitFor(() => expect(api.getLatestBarrierSnapshot).toHaveBeenCalledOnce());
    await waitFor(() => expect(view.result.current.busy).toBe(false));
    expect(view.result.current.saved).toBeNull(); expect(view.result.current.message).toContain('No saved barrier snapshot was found');
    expect(api.changeBarrierRegistry).not.toHaveBeenCalled(); expect(view.result.current.registry).toBeNull();
  });
  it('shows the latest explicit-empty history instead of retaining a previous nonempty set', async () => {
    const f = fixture([7]), view = await mounted(f), empty = registry([], '2');
    empty.state = 'ready'; empty.reasonCodes = []; empty.snapshot = { snapshotId: id(30), scope, registryRevision: '2', contentSha256: 'e'.repeat(64), mode: 'explicit-empty' };
    const publishedEmpty = manifest(empty, 'Saved reviewed empty scope');
    vi.mocked(api.getBarrierRegistry).mockRejectedValueOnce(frameUnavailable()); vi.mocked(api.getLatestBarrierSnapshot).mockResolvedValueOnce(publishedEmpty);
    await act(() => view.result.current.refresh());
    expect(view.result.current.saved?.manifest.selectedParents).toEqual([]);
    expect(view.result.current.saved?.manifest.geometry).toMatchObject({ mode: 'explicit-empty', reason: 'Saved reviewed empty scope' });
    expect(view.result.current.registry).toBeNull(); expect(api.changeBarrierRegistry).not.toHaveBeenCalled();
  });
  it.each([401, 403])('clears saved values on HTTP %s and never attempts historical fallback', async status => {
    const f = fixture([7]), view = await mounted(f);
    vi.mocked(api.getBarrierRegistry).mockRejectedValueOnce(Object.assign(new Error('Access unavailable'), { status }));
    await act(() => view.result.current.refresh());
    expect(view.result.current.saved).toBeNull(); expect(view.result.current.draftParents).toEqual([]); expect(view.result.current.registry).toBeNull();
    expect(api.getLatestBarrierSnapshot).not.toHaveBeenCalled(); expect(view.result.current.canAuthor).toBe(false);
  });
  it('clears retained saved names if historical fallback itself denies access', async () => {
    const f = fixture([7]), view = await mounted(f);
    vi.mocked(api.getBarrierRegistry).mockRejectedValueOnce(frameUnavailable());
    vi.mocked(api.getLatestBarrierSnapshot).mockRejectedValueOnce(Object.assign(new Error('Access unavailable'), { status: 403 }));
    await act(() => view.result.current.refresh()); expect(view.result.current.saved).toBeNull(); expect(view.result.current.registry).toBeNull();
    expect(view.result.current.canRetry).toBe(false); expect(api.getLatestBarrierSnapshot).toHaveBeenCalledOnce();
  });
  it.each(['token', 'project', 'model', 'role'] as const)('fences late historical names after %s ownership changes', async kind => {
    const f = fixture([7]), published = manifest(f.getRegistry()), history = deferred<BarrierSnapshot | null>();
    vi.mocked(api.getBarrierRegistry).mockRejectedValueOnce(frameUnavailable()).mockImplementation(() => new Promise(() => {}));
    vi.mocked(api.getLatestBarrierSnapshot).mockReturnValueOnce(history.promise);
    const view = renderHook((options: Options) => usePathfinderBarriers(options), { initialProps: f.options });
    await waitFor(() => expect(api.getLatestBarrierSnapshot).toHaveBeenCalledOnce());
    const next = kind === 'token' ? { ...f.options, token: 'new-login' } : kind === 'project' ? { ...f.options, projectId: id(999), loadedProjectId: id(999) }
      : kind === 'role' ? { ...f.options, isAdmin: false } : { ...f.options, pf: { ...f.pf, data: { ...f.pf.data!, activeModel: { ...f.pf.data!.activeModel, modelVersionId: id(999) } } } };
    view.rerender(next); await act(async () => history.resolve(published));
    expect(view.result.current.saved).toBeNull(); expect(view.result.current.registry).toBeNull(); expect(api.beginBarrierCapture).not.toHaveBeenCalled();
  });
  it('retains a dirty draft base through failed reads and refuses to rebase its IDs into a changed frame', async () => {
    const f = fixture([7]), view = await mounted(f); f.readSelection.mockResolvedValue(selection(8)); await add(view);
    vi.mocked(api.getBarrierRegistry).mockRejectedValueOnce(new Error('Temporary read failure')); await act(() => view.result.current.refresh());
    const changed = registry([parent(7)]); changed.scope.captureFrameId = id(900); changed.snapshot!.scope.captureFrameId = id(900); f.setRegistry(changed);
    await act(() => view.result.current.refresh()); expect(view.result.current.phase).toBe('stale');
    expect(view.result.current.draftParents.map(value => value.dbId)).toEqual([7, 8]);
    await act(() => view.result.current.save()); expect(api.beginBarrierCapture).not.toHaveBeenCalled();
  });
  it('keeps an uncertain command and exact retry key unsettled through historical fallback', async () => {
    const f = fixture([7]), view = await mounted(f); f.readSelection.mockResolvedValue(selection(8)); await add(view);
    vi.mocked(api.beginBarrierCapture).mockRejectedValueOnce(new TypeError('Lost acknowledgement')); await act(() => view.result.current.save());
    const command = vi.mocked(api.beginBarrierCapture).mock.calls[0][2], published = manifest(f.getRegistry());
    vi.mocked(api.getBarrierRegistry).mockRejectedValueOnce(frameUnavailable()); vi.mocked(api.getLatestBarrierSnapshot).mockResolvedValueOnce(published);
    await act(() => view.result.current.refresh());
    expect(view.result.current.phase).toBe('unknown'); expect(view.result.current.pending).toBe(true); expect(view.result.current.canRetry).toBe(true);
    expect(view.result.current.registry).toBeNull(); expect(api.beginBarrierCapture).toHaveBeenCalledOnce();
    await act(() => view.result.current.retry()); expect(vi.mocked(api.beginBarrierCapture).mock.calls[1][2]).toBe(command);
  });
});

describe('barrier readiness after project preparation', () => {
  it('rereads a cold missing frame when trace readiness changes with the same model and artifact', async () => {
    const f = fixture([7]), options = preparedOptions(f.options, 800), published = manifest(f.getRegistry());
    vi.mocked(api.getBarrierRegistry).mockRejectedValueOnce(frameUnavailable());
    vi.mocked(api.getLatestBarrierSnapshot).mockResolvedValueOnce(published);
    const view = renderHook((props: Options) => usePathfinderBarriers(props), { initialProps: options });
    await waitFor(() => expect(view.result.current.saved?.status).toBe('unavailable'));
    expect(view.result.current.registry).toBeNull();
    view.rerender({ ...options, refreshKey: 'verified-trace-ready' });
    expect(view.result.current.registry).toBeNull();
    await waitFor(() => expect(view.result.current.saved?.status).toBe('current'));
    expect(view.result.current.registry?.state).toBe('ready'); expect(view.result.current.draftParents).toEqual([parent(7)]);
    expect(api.getBarrierRegistry).toHaveBeenCalledTimes(2); expect(api.getBarrierSnapshot).toHaveBeenCalledOnce();
    expect(api.getLatestBarrierSnapshot).toHaveBeenCalledOnce(); expect(api.beginBarrierCapture).not.toHaveBeenCalled();
    expect(api.changeBarrierRegistry).not.toHaveBeenCalled(); expect(f.captureBarriers).not.toHaveBeenCalled();
  });
  it('immediately withholds admission and rereads after a same-model artifact publication', async () => {
    const f = fixture([7]), view = await mounted(f), next = deferred<BarrierRegistry>();
    vi.mocked(api.getBarrierRegistry).mockReturnValueOnce(next.promise);
    view.rerender(preparedOptions(f.options, 801));
    expect(view.result.current.registry).toBeNull(); expect(view.result.current.manifest).toBeNull();
    expect(view.result.current.canAuthor).toBe(false); expect(view.result.current.saved?.status).toBe('unavailable');
    await waitFor(() => expect(api.getBarrierRegistry).toHaveBeenCalledTimes(2));
    await act(async () => next.resolve(structuredClone(f.getRegistry())));
    await waitFor(() => expect(view.result.current.registry?.state).toBe('ready'));
    expect(view.result.current.saved?.status).toBe('current'); expect(api.beginBarrierCapture).not.toHaveBeenCalled();
  });
  it('does not reread for unrelated facade renewals or reordered identical artifact metadata', async () => {
    const f = fixture([7]), options = preparedOptions(f.options, 802);
    const extra = preparedOptions(f.options, 803).pf.data!.artifacts[0];
    options.pf.data!.artifacts.push(extra);
    const view = renderHook((props: Options) => usePathfinderBarriers(props), { initialProps: options });
    await waitFor(() => expect(view.result.current.registry?.state).toBe('ready'));
    view.rerender({ ...options, pf: { ...options.pf, data: { ...structuredClone(options.pf.data!), artifacts: [...options.pf.data!.artifacts].reverse() } } });
    await act(async () => {});
    expect(api.getBarrierRegistry).toHaveBeenCalledOnce(); expect(view.result.current.saved?.status).toBe('current');
  });
  it('keeps a dirty draft and original base when a prepared frame changes', async () => {
    const f = fixture([7]), view = await mounted(f); f.readSelection.mockResolvedValue(selection(8)); await add(view);
    const draft = structuredClone(view.result.current.draftParents), next = registry([parent(7)]);
    next.scope.captureFrameId = id(804); next.snapshot!.scope.captureFrameId = id(804); f.setRegistry(next);
    view.rerender({ ...f.options, refreshKey: 'new-frame' });
    expect(view.result.current.registry).toBeNull(); expect(view.result.current.draftParents).toEqual(draft);
    await waitFor(() => expect(view.result.current.phase).toBe('stale'));
    expect(view.result.current.dirty).toBe(true); expect(view.result.current.draftParents).toEqual(draft);
    expect(view.result.current.draftBase?.scope.captureFrameId).toBe(scope.captureFrameId);
    await act(() => view.result.current.save()); expect(api.beginBarrierCapture).not.toHaveBeenCalled();
  });
  it('queues one latest read behind a locked uncertain command without replacing its exact recovery record', async () => {
    const f = fixture([7]), view = await mounted(f); f.readSelection.mockResolvedValue(selection(8)); await add(view);
    const intent = deferred<Awaited<ReturnType<typeof api.beginBarrierCapture>>>();
    vi.mocked(api.beginBarrierCapture).mockReturnValueOnce(intent.promise);
    let saving!: Promise<void>; act(() => { saving = view.result.current.save(); });
    await waitFor(() => expect(api.beginBarrierCapture).toHaveBeenCalledOnce());
    const retained = await readPendingBarrierCommand(sessionStorage, scope.projectId), reads = vi.mocked(api.getBarrierRegistry).mock.calls.length;
    const draft = structuredClone(view.result.current.draftParents);
    view.rerender({ ...f.options, refreshKey: 'trace-one' });
    view.rerender({ ...f.options, refreshKey: 'trace-two' });
    expect(view.result.current.registry).toBeNull(); expect(api.getBarrierRegistry).toHaveBeenCalledTimes(reads);
    await act(async () => { intent.reject(new TypeError('Lost acknowledgement')); await saving; });
    await waitFor(() => expect(api.getBarrierRegistry).toHaveBeenCalledTimes(reads + 1));
    await waitFor(() => expect(view.result.current.registry).not.toBeNull());
    expect(view.result.current.phase).toBe('unknown'); expect(view.result.current.pending).toBe(true);
    expect(view.result.current.dirty).toBe(true); expect(view.result.current.draftParents).toEqual(draft);
    expect(await readPendingBarrierCommand(sessionStorage, scope.projectId)).toEqual(retained);
    expect(api.beginBarrierCapture).toHaveBeenCalledOnce(); expect(f.captureBarriers).not.toHaveBeenCalled();
    expect(f.publishBarriers).not.toHaveBeenCalled(); expect(api.changeBarrierRegistry).not.toHaveBeenCalled();
  });
  it('never restores admission from an old response and coalesces intermediate readiness changes', async () => {
    const f = fixture([7]), view = await mounted(f), old = deferred<BarrierRegistry>(), fresh = deferred<BarrierRegistry>();
    const previous = structuredClone(f.getRegistry()), next = registry([parent(7)], '2'); f.setRegistry(next);
    vi.mocked(api.getBarrierRegistry).mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    let refreshing!: Promise<void>; act(() => { refreshing = view.result.current.refresh(); });
    view.rerender({ ...f.options, refreshKey: 'trace-one' }); view.rerender({ ...f.options, refreshKey: 'trace-two' });
    expect(api.getBarrierRegistry).toHaveBeenCalledTimes(2);
    await act(async () => { old.resolve(previous); await refreshing; });
    await waitFor(() => expect(api.getBarrierRegistry).toHaveBeenCalledTimes(3));
    expect(view.result.current.registry).toBeNull(); expect(view.result.current.saved?.status).toBe('unavailable');
    await act(async () => fresh.resolve(next));
    await waitFor(() => expect(view.result.current.registry?.registryRevision).toBe('2'));
    expect(view.result.current.error).toBeNull(); expect(api.getBarrierSnapshot).toHaveBeenCalledTimes(2);
  });
  it.each(['transport', 'missing-frame'] as const)('ignores an obsolete %s failure and checks the latest preparation once', async kind => {
    const f = fixture([7]), view = await mounted(f), old = deferred<BarrierRegistry>();
    vi.mocked(api.getBarrierRegistry).mockReturnValueOnce(old.promise);
    let refreshing!: Promise<void>; act(() => { refreshing = view.result.current.refresh(); });
    view.rerender({ ...f.options, refreshKey: 'verified-new-trace' });
    await act(async () => { old.reject(kind === 'missing-frame' ? frameUnavailable() : new Error('Old read failed')); await refreshing; });
    await waitFor(() => expect(view.result.current.saved?.status).toBe('current'));
    expect(view.result.current.error).toBeNull(); expect(api.getBarrierRegistry).toHaveBeenCalledTimes(3);
    expect(api.getLatestBarrierSnapshot).not.toHaveBeenCalled();
  });
  it.each(['success', 'failure'] as const)('fences an old manifest %s until the new preparation is fully reread', async outcome => {
    const f = fixture([7]), view = await mounted(f), old = deferred<BarrierSnapshot>(), fresh = deferred<BarrierRegistry>();
    const previous = manifest(f.getRegistry()); vi.mocked(api.getBarrierSnapshot).mockReturnValueOnce(old.promise);
    let refreshing!: Promise<void>; act(() => { refreshing = view.result.current.refresh(); });
    await waitFor(() => expect(api.getBarrierSnapshot).toHaveBeenCalledTimes(2));
    vi.mocked(api.getBarrierRegistry).mockReturnValueOnce(fresh.promise);
    view.rerender({ ...f.options, refreshKey: 'new-trace' });
    await act(async () => { if (outcome === 'success') old.resolve(previous); else old.reject(new Error('Old manifest failed')); await refreshing; });
    await waitFor(() => expect(api.getBarrierRegistry).toHaveBeenCalledTimes(3));
    expect(view.result.current.registry).toBeNull(); expect(view.result.current.manifest).toBeNull(); expect(view.result.current.error).toBeNull();
    await act(async () => fresh.resolve(structuredClone(f.getRegistry())));
    await waitFor(() => expect(view.result.current.saved?.status).toBe('current'));
  });
  it.each(['success', 'failure'] as const)('fences an old historical fallback %s after a new preparation', async outcome => {
    const f = fixture([7]), view = await mounted(f), old = deferred<BarrierSnapshot | null>(), fresh = deferred<BarrierRegistry>();
    vi.mocked(api.getBarrierRegistry).mockRejectedValueOnce(frameUnavailable());
    vi.mocked(api.getLatestBarrierSnapshot).mockReturnValueOnce(old.promise);
    let refreshing!: Promise<void>; act(() => { refreshing = view.result.current.refresh(); });
    await waitFor(() => expect(api.getLatestBarrierSnapshot).toHaveBeenCalledOnce());
    vi.mocked(api.getBarrierRegistry).mockReturnValueOnce(fresh.promise);
    view.rerender({ ...f.options, refreshKey: 'new-trace' });
    await act(async () => { if (outcome === 'success') old.resolve(manifest(registry([parent(9)]))); else old.reject(new Error('Old history failed')); await refreshing; });
    await waitFor(() => expect(api.getBarrierRegistry).toHaveBeenCalledTimes(3));
    expect(view.result.current.registry).toBeNull(); expect(view.result.current.error).toBeNull();
    expect(view.result.current.saved?.manifest.selectedParents).toEqual([parent(7)]);
    await act(async () => fresh.resolve(structuredClone(f.getRegistry())));
    await waitFor(() => expect(view.result.current.saved?.status).toBe('current'));
  });
  it('keeps a current reread failure unavailable without retrying on ordinary rerenders', async () => {
    const f = fixture([7]), view = await mounted(f);
    vi.mocked(api.getBarrierRegistry).mockRejectedValueOnce(new Error('Current registry read failed'));
    const next = { ...f.options, refreshKey: 'verified-new-trace' }; view.rerender(next);
    await waitFor(() => expect(view.result.current.error).toBe('Current registry read failed'));
    expect(view.result.current.registry).toBeNull(); expect(view.result.current.saved?.status).toBe('unavailable');
    view.rerender({ ...next, pf: { ...next.pf, data: structuredClone(next.pf.data) } }); await act(async () => {});
    expect(api.getBarrierRegistry).toHaveBeenCalledTimes(2); expect(api.beginBarrierCapture).not.toHaveBeenCalled();
  });
  it.each([401, 403])('preserves an HTTP %s access refusal even if the failed read predates a new preparation', async status => {
    const f = fixture([7]), view = await mounted(f), old = deferred<BarrierRegistry>();
    vi.mocked(api.getBarrierRegistry).mockReturnValueOnce(old.promise);
    let refreshing!: Promise<void>; act(() => { refreshing = view.result.current.refresh(); });
    view.rerender({ ...f.options, refreshKey: 'verified-new-trace' });
    await act(async () => { old.reject(Object.assign(new Error('Access unavailable'), { status })); await refreshing; });
    expect(view.result.current.saved).toBeNull(); expect(view.result.current.registry).toBeNull(); expect(view.result.current.canAuthor).toBe(false);
    expect(view.result.current.error).toBe('Current administrator access is required. Refresh your account to continue.');
    expect(api.getBarrierRegistry).toHaveBeenCalledTimes(2); expect(api.getLatestBarrierSnapshot).not.toHaveBeenCalled();
  });
});

describe('administrator barrier authoring lifecycle', () => {
  it('does not read or write when administrator access is absent', async () => {
    const f = fixture(); const view = renderHook(() => usePathfinderBarriers({ ...f.options, isAdmin: false }));
    await act(() => view.result.current.refresh()); await act(() => view.result.current.addSelection()); await act(() => view.result.current.save());
    expect(api.getBarrierRegistry).not.toHaveBeenCalled(); expect(f.runProjectPreparation).not.toHaveBeenCalled(); expect(api.beginBarrierCapture).not.toHaveBeenCalled(); expect(view.result.current.canAuthor).toBe(false);
  });
  it('reads the authoritative frame and exposes no invented manifest counts for an unconfigured scope', async () => {
    const f = fixture(); const view = await mounted(f); expect(view.result.current.registry?.scope).toEqual(scope); expect(view.result.current.manifest).toBeNull(); expect(api.getBarrierSnapshot).not.toHaveBeenCalled();
    expect(api.getBarrierRegistry).toHaveBeenCalledWith(id(1), 'synthetic-login', expect.any(AbortSignal));
  });
  it('preserves parent identity and overlapping parent choices while deduplicating exact selections', async () => {
    const f = fixture(); const view = await mounted(f); f.readSelection.mockResolvedValue(selection(7, 8)); await add(view); const original = structuredClone(view.result.current.draftParents);
    await add(view); expect(view.result.current.draftParents).toEqual(original); expect(original.map(p => p.objectId)).toEqual(['dbid:7', 'dbid:8']);
    expect(original.every(p => p.inclusion === 'own-and-all-descendant-fragments')).toBe(true); expect(f.readSelection).toHaveBeenCalledTimes(2);
    expect(f.runProjectPreparation.mock.calls[0][0]).toMatchObject({ modelVersionId: id(2), selectionRevision: '1', contentFingerprint: scope.contentFingerprint });
  });
  it('accumulates 2048 parents in selection batches and atomically refuses object 2049', async () => {
    const f = fixture(); const view = await mounted(f);
    for (let page = 0; page < 128; page++) { f.readSelection.mockResolvedValue(selection(...Array.from({ length: 16 }, (_, i) => 1 + page * 16 + i))); await add(view); }
    expect(view.result.current.draftParents).toHaveLength(2048); const original = structuredClone(view.result.current.draftParents);
    expect(new Set(original.map(item => item.objectId)).size).toBe(2048);
    f.readSelection.mockResolvedValue(selection(2049)); await add(view); expect(view.result.current.draftParents).toEqual(original); expect(view.result.current.error).toBeTruthy();
  });
  it('keeps the previous published head while a changed draft is not yet saved', async () => {
    const f = fixture([7]); const view = await mounted(f); const old = view.result.current.registry!.snapshot; f.readSelection.mockResolvedValue(selection(8)); await add(view);
    expect(view.result.current.dirty).toBe(true); expect(view.result.current.registry!.snapshot).toEqual(old); expect(api.beginBarrierCapture).not.toHaveBeenCalled(); expect(f.publishBarriers).not.toHaveBeenCalled();
  });
  it('freezes exact current frame/revision/parents and publishes only the protected capture result', async () => {
    const f = fixture(); const view = await mounted(f); await add(view); const parents = structuredClone(view.result.current.draftParents); await act(() => view.result.current.save());
    const command = vi.mocked(api.beginBarrierCapture).mock.calls[0][2]; expect(command).toMatchObject({ scope, expectedRegistryRevision: '1', selectedParents: parents }); expect(command.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(f.captureBarriers).toHaveBeenCalledWith(expect.objectContaining({ captureId: id(20), scope, selectedParents: parents }));
    expect(f.publishBarriers).toHaveBeenCalledWith(id(20), f.observation, undefined, expect.objectContaining({ schemaVersion: 'wfc.pf.barrier-capture-command.v2', geometryPolicy: MIXED_BARRIER_POLICY })); expect(view.result.current.pending).toBe(false); expect(view.result.current.dirty).toBe(false);
  });
  it('does not clear, Ghost, hide or redraw the model when reading or assigning selected barriers', async () => {
    const f = fixture(); const view = await mounted(f); await add(view); expect(f.readSelection).toHaveBeenCalled(); for (const operation of Object.values(f.appearance)) expect(operation).not.toHaveBeenCalled();
  });
  it('retains an uncertain begin command and retries its original key instead of minting a replacement', async () => {
    const f = fixture(); const view = await mounted(f); await add(view); vi.mocked(api.beginBarrierCapture).mockRejectedValueOnce(new TypeError('Lost acknowledgement'));
    await act(() => view.result.current.save()); expect(view.result.current.pending).toBe(true); expect(view.result.current.phase).toBe('unknown'); const command = vi.mocked(api.beginBarrierCapture).mock.calls[0][2];
    await act(() => view.result.current.refresh()); expect(view.result.current.pending).toBe(true); await act(() => view.result.current.discardPending()); expect(view.result.current.pending).toBe(true);
    await act(() => view.result.current.retry()); expect(vi.mocked(api.beginBarrierCapture).mock.calls[1][2]).toBe(command); expect(f.captureBarriers).toHaveBeenCalledTimes(1);
  });
  it.each((['begin', 'publication', 'empty'] as const).flatMap(stage => (['mismatched frame', 'manifest404', 'read403'] as const).map(kind => ({ stage, kind }))))('retains unknown $stage through an unrelated $kind display failure', async ({ stage, kind }) => {
    const f = fixture([7]); const view = await mounted(f); const old = view.result.current.registry!.snapshot;
    if (stage === 'empty') {
      await act(() => view.result.current.removeParent(parent(7).selectionId)); act(() => view.result.current.setEmptyReason('Reviewed empty scope'));
      vi.mocked(api.changeBarrierRegistry).mockRejectedValueOnce(new TypeError('Lost empty acknowledgement'));
    } else {
      f.readSelection.mockResolvedValue(selection(8)); await add(view);
      if (stage === 'begin') vi.mocked(api.beginBarrierCapture).mockRejectedValueOnce(new TypeError('Lost command acknowledgement'));
      else f.publishBarriers.mockRejectedValueOnce(new TypeError('Lost publication acknowledgement'));
    }
    await act(() => view.result.current.save()); expect(view.result.current.phase).toBe('unknown');
    const command = stage === 'empty' ? vi.mocked(api.changeBarrierRegistry).mock.calls[0][2] : vi.mocked(api.beginBarrierCapture).mock.calls[0][2];
    if (kind === 'mismatched frame') {
      const otherFrame = manifest(f.getRegistry()); otherFrame.scope = { ...otherFrame.scope, captureFrameId: id(999) };
      vi.mocked(api.getBarrierSnapshot).mockResolvedValueOnce(otherFrame);
    } else {
      vi.mocked(api.getBarrierSnapshot).mockRejectedValueOnce(Object.assign(new Error('Display read denied'), { status: kind === 'read403' ? 403 : 404, code: kind === 'read403' ? 'ADMIN_REQUIRED' : 'BARRIER_SNAPSHOT_NOT_FOUND' }));
    }
    await act(() => view.result.current.refresh());
    expect(view.result.current.phase).toBe('unknown'); expect(view.result.current.pending).toBe(true);
    if (kind === 'read403') { expect(view.result.current.registry).toBeNull(); expect(view.result.current.draftParents).toHaveLength(0); expect(view.result.current.canAuthor).toBe(false); }
    else { expect(view.result.current.registry).toBeNull(); expect(view.result.current.saved?.manifest.snapshotId).toBe(old!.snapshotId); expect(view.result.current.canRetry).toBe(true); }
    await act(() => view.result.current.discardPending()); await act(() => view.result.current.save());
    expect(view.result.current.phase).toBe('unknown'); expect(view.result.current.pending).toBe(true);
    expect(api.beginBarrierCapture).toHaveBeenCalledTimes(stage === 'empty' ? 0 : 1); expect(api.changeBarrierRegistry).toHaveBeenCalledTimes(stage === 'empty' ? 1 : 0);
    expect(stage === 'empty' ? vi.mocked(api.changeBarrierRegistry).mock.calls[0][2] : vi.mocked(api.beginBarrierCapture).mock.calls[0][2]).toBe(command);
    expect(f.captureBarriers).toHaveBeenCalledTimes(stage === 'publication' ? 1 : 0); expect(f.publishBarriers).toHaveBeenCalledTimes(stage === 'publication' ? 1 : 0);
  });
  it('retains a completed observation after an uncertain publish and reconciles it without recapture', async () => {
    const f = fixture([7]); const view = await mounted(f); f.readSelection.mockResolvedValue(selection(8)); await add(view); const old = view.result.current.registry!.snapshot;
    f.publishBarriers.mockRejectedValueOnce(new TypeError('Lost publication acknowledgement')); await act(() => view.result.current.save());
    expect(view.result.current.phase).toBe('unknown'); expect(view.result.current.pending).toBe(true); expect(view.result.current.registry!.snapshot).toEqual(old);
    const first = f.publishBarriers.mock.calls[0]; await act(() => view.result.current.retry()); expect(f.captureBarriers).toHaveBeenCalledTimes(1); expect(f.publishBarriers.mock.calls[1]).toEqual(first);
  });
  it('reports a known publication preflight refusal without claiming an unknown PUT outcome', async () => {
    const f = fixture([7]), view = await mounted(f); f.readSelection.mockResolvedValue(selection(8)); await add(view);
    const old = view.result.current.registry!.snapshot;
    f.publicationPreflight.mockRejectedValueOnce(Object.assign(new Error('private SDK details'), { code: 'BARRIER_CAPTURE_GEOMETRY_NOT_READY', status: 409 }));
    await act(() => view.result.current.save());
    expect(f.publishBarriers).not.toHaveBeenCalled(); expect(f.captureBarriers).toHaveBeenCalledOnce();
    expect(view.result.current.phase).toBe('refused'); expect(view.result.current.pending).toBe(true); expect(view.result.current.canRetry).toBe(true);
    expect(view.result.current.error).toBe(BARRIER_CAPTURE_ERROR_MESSAGES.BARRIER_CAPTURE_GEOMETRY_NOT_READY);
    expect(view.result.current.error).not.toContain('private SDK'); expect(view.result.current.registry!.snapshot).toEqual(old);
    const command = vi.mocked(api.beginBarrierCapture).mock.calls[0][2];
    await act(() => view.result.current.retry());
    expect(api.beginBarrierCapture).toHaveBeenCalledOnce(); expect(vi.mocked(api.beginBarrierCapture).mock.calls[0][2]).toBe(command);
    expect(f.captureBarriers).toHaveBeenCalledOnce();
    expect(f.publishBarriers).toHaveBeenCalledExactlyOnceWith(id(20), f.observation, undefined, command);
    expect(view.result.current.phase).toBe('ready'); expect(view.result.current.pending).toBe(false);
  });
  it.each([409, 403])('retains an earlier uncertain PUT when replay preflight returns %s before another PUT', async status => {
    const f = fixture([7]), view = await mounted(f); f.readSelection.mockResolvedValue(selection(8)); await add(view);
    f.publishBarriers.mockRejectedValueOnce(new TypeError('Lost publication acknowledgement'));
    await act(() => view.result.current.save());
    expect(view.result.current.phase).toBe('unknown');
    const command = vi.mocked(api.beginBarrierCapture).mock.calls[0][2], original = f.publishBarriers.mock.calls[0];
    f.publicationPreflight.mockRejectedValueOnce(Object.assign(new Error('Preflight refused'), { status, code: status === 403 ? 'ADMIN_REQUIRED' : 'BARRIER_CONTEXT_CHANGED' }));
    await act(() => view.result.current.retry());
    expect(view.result.current.phase).toBe('unknown'); expect(view.result.current.pending).toBe(true);
    expect(f.publishBarriers).toHaveBeenCalledOnce(); expect(f.publishBarriers.mock.calls[0]).toEqual(original);
    expect(f.captureBarriers).toHaveBeenCalledOnce(); expect(api.beginBarrierCapture).toHaveBeenCalledOnce();
    expect(vi.mocked(api.beginBarrierCapture).mock.calls[0][2]).toBe(command);
    await act(() => view.result.current.discardPending()); await act(() => view.result.current.save());
    expect(view.result.current.pending).toBe(true); expect(view.result.current.phase).toBe('unknown'); expect(f.publishBarriers).toHaveBeenCalledOnce();
  });
  it('explains a missing server verifier while retaining the pending command and published barriers', async () => {
    const f = fixture([7]), view = await mounted(f); f.readSelection.mockResolvedValue(selection(8)); await add(view);
    const old = view.result.current.registry!.snapshot;
    f.publishBarriers.mockRejectedValueOnce(Object.assign(new Error('private server path'), { status: 503, code: 'BARRIER_VERIFIER_NOT_CONFIGURED' }));
    await act(() => view.result.current.save());
    expect(view.result.current.phase).toBe('unknown'); expect(view.result.current.pending).toBe(true);
    expect(view.result.current.error).toContain('Update the API container');
    expect(view.result.current.error).toContain('BARRIER_VERIFIER_NOT_CONFIGURED');
    expect(view.result.current.error).not.toContain('private server path');
    expect(view.result.current.registry!.snapshot).toEqual(old); expect(view.result.current.canDiscard).toBe(false);
    await act(() => view.result.current.save());
    expect(api.beginBarrierCapture).toHaveBeenCalledOnce(); expect(f.captureBarriers).toHaveBeenCalledOnce();
    expect(f.publishBarriers).toHaveBeenCalledOnce();
  });
  it('retains a dispatched publication refusal as unknown without a validated exact success receipt', async () => {
    const f = fixture([7]), view = await mounted(f); f.readSelection.mockResolvedValue(selection(8)); await add(view);
    f.publishBarriers.mockRejectedValueOnce(Object.assign(new Error('Publication refused'), { status: 409, code: 'BARRIER_CAPTURE_SCOPE' }));
    await act(() => view.result.current.save());
    expect(f.publishBarriers).toHaveBeenCalledOnce(); expect(view.result.current.phase).toBe('unknown'); expect(view.result.current.pending).toBe(true);
    await act(() => view.result.current.retry());
    expect(f.captureBarriers).toHaveBeenCalledOnce(); expect(api.beginBarrierCapture).toHaveBeenCalledOnce();
    expect(f.publishBarriers.mock.calls[1]).toEqual(f.publishBarriers.mock.calls[0]); expect(view.result.current.phase).toBe('ready');
  });
  it('keeps the old good head when protected geometry capture refuses', async () => {
    const f = fixture([7]); const view = await mounted(f); const old = view.result.current.registry!.snapshot; f.readSelection.mockResolvedValue(selection(8)); await add(view);
    f.captureBarriers.mockRejectedValueOnce(new Error('Selected parent has unavailable geometry')); await act(() => view.result.current.save());
    expect(f.publishBarriers).not.toHaveBeenCalled(); expect(view.result.current.registry!.snapshot).toEqual(old); expect(view.result.current.dirty).toBe(true); expect(view.result.current.error).toBeTruthy();
  });
  it.each(['BARRIER_CAPTURE_HIERARCHY_LIMIT', 'BARRIER_CAPTURE_FRAGMENT_LIMIT'] as const)('presents %s safely and retains the exact saved intent and old publication', async code => {
    const f = fixture([7]), view = await mounted(f); f.readSelection.mockResolvedValue(selection(8)); await add(view);
    const old = view.result.current.registry!.snapshot;
    f.captureBarriers.mockRejectedValueOnce(Object.assign(Error('private RVM object details'), { code }));
    await act(() => view.result.current.save());
    expect(view.result.current.error).toBe(BARRIER_CAPTURE_ERROR_MESSAGES[code]); expect(view.result.current.error).not.toContain('private RVM');
    expect(view.result.current.registry?.snapshot).toEqual(old); expect(view.result.current.pending).toBe(true);
    expect(view.result.current.canRetry).toBe(true); expect(view.result.current.phase).toBe('refused'); expect(f.publishBarriers).not.toHaveBeenCalled();
    const command = vi.mocked(api.beginBarrierCapture).mock.calls[0][2], captured = f.captureBarriers.mock.calls[0][0];
    await act(() => view.result.current.retry());
    expect(api.beginBarrierCapture).toHaveBeenCalledOnce(); expect(f.captureBarriers.mock.calls[1][0]).toEqual(captured);
    expect(f.captureBarriers.mock.calls[1][0].scope).toEqual(command.scope); expect(api.changeBarrierRegistry).not.toHaveBeenCalled();
  });
  it('does not expose an unknown barrier-capture code or its raw SDK text', async () => {
    const f = fixture(), view = await mounted(f); await add(view);
    f.captureBarriers.mockRejectedValueOnce(Object.assign(Error('private SDK path'), { code: 'BARRIER_CAPTURE_PRIVATE_DETAIL' }));
    await act(() => view.result.current.save());
    expect(view.result.current.error).toContain('could not be read completely'); expect(view.result.current.error).not.toContain('private SDK');
    expect(f.publishBarriers).not.toHaveBeenCalled(); expect(view.result.current.pending).toBe(true);
  });
  it('retains a valid old head and the exact saved command after a structurally valid partial capture', async () => {
    const f = fixture([7]); const view = await mounted(f); const old = view.result.current.registry!.snapshot; f.readSelection.mockResolvedValue(selection(8)); await add(view);
    f.captureBarriers.mockImplementationOnce(async request => { const value = f.makeObservation(request); value.capture.observation.state = 'partial'; return value; });
    await act(() => view.result.current.save()); expect(view.result.current.phase).toBe('partial'); expect(view.result.current.pending).toBe(true);
    expect(view.result.current.registry!.snapshot).toEqual(old); expect(f.publishBarriers).not.toHaveBeenCalled();
  });
  it('removes a subset by recapturing all remaining parents rather than sending a remove mutation', async () => {
    const f = fixture([7, 8]); const view = await mounted(f); await act(() => view.result.current.removeParent(parent(7).selectionId)); expect(view.result.current.draftParents.map(p => p.dbId)).toEqual([8]);
    expect(api.changeBarrierRegistry).not.toHaveBeenCalled(); await act(() => view.result.current.save());
    expect(vi.mocked(api.beginBarrierCapture).mock.calls[0][2].selectedParents.map(p => p.dbId)).toEqual([8]); expect(api.changeBarrierRegistry).not.toHaveBeenCalled();
  });
  it('requires an explicit reason before declaring the last removed parent scope empty', async () => {
    const f = fixture([7]); const view = await mounted(f); await act(() => view.result.current.removeParent(parent(7).selectionId)); await act(() => view.result.current.save()); expect(api.changeBarrierRegistry).not.toHaveBeenCalled();
    act(() => view.result.current.setEmptyReason('   ')); await act(() => view.result.current.save()); expect(api.changeBarrierRegistry).not.toHaveBeenCalled();
    act(() => view.result.current.setEmptyReason('Reviewed selected scope has no barriers')); await act(() => view.result.current.save());
    expect(vi.mocked(api.changeBarrierRegistry).mock.calls[0][2]).toMatchObject({ action: 'declare-empty', scope, expectedRegistryRevision: '1', reason: 'Reviewed selected scope has no barriers' }); expect(f.captureBarriers).not.toHaveBeenCalled();
  });
  it('reconciles an unknown empty declaration with the original frozen reason and key', async () => {
    const f = fixture([7]); const view = await mounted(f); await act(() => view.result.current.removeParent(parent(7).selectionId)); act(() => view.result.current.setEmptyReason('Original reviewed reason'));
    vi.mocked(api.changeBarrierRegistry).mockRejectedValueOnce(new TypeError('Unknown write outcome')); await act(() => view.result.current.save()); const command = vi.mocked(api.changeBarrierRegistry).mock.calls[0][2];
    expect(view.result.current.pending).toBe(true); act(() => view.result.current.setEmptyReason('Later draft reason')); await act(() => view.result.current.retry()); expect(vi.mocked(api.changeBarrierRegistry).mock.calls[1][2]).toBe(command);
  });
  it.each(['role', 'token', 'project', 'model', 'generation'] as const)('aborts and fences a late capture after %s changes', async kind => {
    const f = fixture(); const view = await mounted(f); await add(view); const late = deferred<typeof f.observation>(); f.captureBarriers.mockReturnValueOnce(late.promise);
    let saving!: Promise<unknown>; act(() => { saving = view.result.current.save(); }); await waitFor(() => expect(f.captureBarriers).toHaveBeenCalled()); const signal = f.runProjectPreparation.mock.calls.at(-1)![2];
    let options = f.options;
    if (kind === 'role') options = { ...options, isAdmin: false };
    if (kind === 'token') options = { ...options, token: 'another-login' };
    if (kind === 'project') options = { ...options, projectId: id(999), loadedProjectId: id(999) };
    if (kind === 'model') options = { ...options, pf: { ...options.pf, data: { ...options.pf.data!, activeModel: { modelVersionId: id(999), selectionRevision: '2', contentFingerprint: 'f'.repeat(64) } } } };
    if (kind === 'generation') options = { ...options, pf: { ...options.pf, preparationViewerGeneration: 2 } };
    view.rerender(options); await act(async () => { late.resolve(f.observation); await saving; }); expect(signal?.aborted).toBe(true); expect(f.publishBarriers).not.toHaveBeenCalled();
  });
  it('accepts a late successful publication across an ordinary same-identity facade renewal', async () => {
    const f = fixture(); const view = await mounted(f); await add(view); const late = deferred<Awaited<ReturnType<typeof f.publishBarriers>>>(); f.publishBarriers.mockReturnValueOnce(late.promise);
    let saving!: Promise<unknown>; act(() => { saving = view.result.current.save(); }); await waitFor(() => expect(f.publishBarriers).toHaveBeenCalled());
    const renewed = { ...f.options, pf: { ...f.pf, data: structuredClone(f.pf.data) } }; view.rerender(renewed);
    const next = mixedRegistry(view.result.current.draftParents, '2'); next.snapshot!.snapshotId = id(21); f.setRegistry(next);
    if (next.schemaVersion !== 'wfc.pf.barrier-registry.v2') throw Error('fixture');
    await act(async () => { late.resolve({ schemaVersion: 'wfc.pf.barrier-publication-receipt.v2', snapshot: next.snapshot!, duplicate: false }); await saving; });
    expect(view.result.current.pending).toBe(false); expect(view.result.current.registry!.snapshot).toEqual(next.snapshot);
  });
  it('retains a dirty draft but refuses to save against a newly observed prepared frame', async () => {
    const f = fixture([7]); const view = await mounted(f); f.readSelection.mockResolvedValue(selection(8)); await add(view); const draft = structuredClone(view.result.current.draftParents);
    const changed = registry([parent(7)]); changed.scope.captureFrameId = id(900); changed.snapshot!.scope.captureFrameId = id(900); f.setRegistry(changed);
    await act(() => view.result.current.refresh()); expect(view.result.current.phase).toBe('stale'); expect(view.result.current.draftParents).toEqual(draft);
    await act(() => view.result.current.save()); expect(api.beginBarrierCapture).not.toHaveBeenCalled();
  });
});
