import { describe, expect, it, vi } from 'vitest';
import { preparationContextSchema, preparationSessionSchema, preparationPartReceiptSchema, preparationPublicationSchema, type PreparationSession, type PreparationPart,
  preparationCreateSchema } from '../../shared/pathfinderPreparation.js';
import { captureEvidenceReceiptSchema } from '../../shared/pathfinderGeometryTrace.js';
import { createCompletedCaptureEvidence, verifyCompletedCaptureEvidence } from '../../viewer-runtime/capture-evidence.mjs';
import type { ModelCaptureRequest } from '../../viewer-runtime/protocol.mjs';
import type { PreparationDiscoveryRequest, PreparationDiscoveryPage } from '../../viewer-runtime/preparation-input.mjs';
import { calculationGrantAuthoritySchema, calculationGrantProvenance } from './calculationAuthority.js';
import { grantOperationPrincipal, type OperationPrincipal } from './operationAuthority.js';
import { buildPreparationPlan, preparationDigest } from './preparationPlans.js';
import { snapshotSchema } from './contracts.js';
import { runManagedPreparationWorkflow, type ManagedPreparationCheckpoint, type ManagedPreparationWorkflowOptions } from './managedPreparationWorkflow.js';
import { PathFinderError } from './errors.js';

const id = (number: number) => `c8000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const clone = <T>(value: T): T => structuredClone(value);
const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const observed = <T>(value: T) => ({ status: 'observed' as const, value, api: 'synthetic managed workflow fixture', reason: null });
const derived = <T>(value: T) => ({ status: 'derived' as const, value, api: 'synthetic normalization', reason: null });
const missing = { status: 'unavailable' as const, value: null, api: 'synthetic', reason: 'SDK_VALUE_UNAVAILABLE' };
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };

function fixture() {
  const authority = calculationGrantAuthoritySchema.parse({ kind: 'calculation-grant', projectId: id(1), grantId: id(4), grantRevision: '1', grantEpoch: '1',
    installationEpoch: id(5), issuerId: id(6), issuerAdminRevision: '1', leaseId: id(7), ownerToken: 'f'.repeat(64),
    leaseExpiresAt: new Date(Date.now() + 14 * 60000).toISOString(), operation: 'prepare', modelVersionId: id(2), selectionRevision: '1', contentFingerprint: 'a'.repeat(64) });
  let context = preparationContextSchema.parse({ schemaVersion: 'wfc.pf.preparation-context.v1', projectId: id(1),
    scope: { modelVersionId: id(2), selectionRevision: '1', contentFingerprint: 'a'.repeat(64), catalogRevision: '2', routingContentSha256: 'b'.repeat(64),
      routingPolicyRevision: '3', routingPolicySha256: 'c'.repeat(64), locationRegistryRevision: '4', resolutionRevision: '0' },
    trays: [{ projectTrayId: id(10), rawName: '/B001', routeName: '/B001', purposeKey: 'Control', allowedCategories: ['Control'], policyState: 'configured', diagnosticCodes: [] }],
    endpointNames: [], resolutions: [], diagnostics: [], currentAggregate: null });
  const principal = grantOperationPrincipal(authority), grant = calculationGrantProvenance(authority), events: string[] = [];
  const flags = { allowed: true, closed: false, loseCreateAck: false, loseUploadAck: false, loseEvidenceAck: false, losePublishAck: false,
    ambiguous: false, wrongEvidence: false, holdUpload: null as Promise<void> | null };
  let saved: ManagedPreparationCheckpoint | null = null, session: PreparationSession | null = null, published: unknown = null, nextId = 100;
  const journal: ManagedPreparationCheckpoint[] = [], evidence = new Map<string, unknown>();
  const snapshot = snapshotSchema.parse({ schemaVersion: 'pathfinder.model.snapshot.v1', model: { projectId: id(1), modelVersionId: id(2), contentSha256: 'a'.repeat(64) },
    capture: { adapterVersion: 'synthetic-workflow-test', sourceKind: 'synthetic', inventoryComplete: false, geometryComplete: false, unitsVerified: false,
      transformsVerified: false, planningVisibilityKnown: false, sourceLinkVerified: false, evidenceSha256: [] },
    coordinates: { vertexFrame: 'canonical-world-metres', sourceUnits: 'm', metresPerSourceUnit: 1, sourceToWorldMetres: null, displayToWorldMetres: matrix, globalOffsetMetres: [0, 0, 0] },
    objects: [{ id: 'dbid:3', parentId: null, dbId: 3, name: '/B001', geometryRole: 'routing-leaf', leafToRootNames: ['/B001'], properties: [], nativeHidden: null,
      planningExcluded: false, routeName: '/B001', shapeName: '/B001', categoryAssignmentSource: 'explicit-planning', allowedCategories: ['Control'],
      bounds: { minimum: [0, 0, 0], maximum: [1, 1, 1] }, fragments: [{ id: 'fragment:3', vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 1]], triangleIndices: [0, 1, 2], fragmentToWorldMetres: matrix, transformAlreadyApplied: true }] }] });
  const driver: ManagedPreparationWorkflowOptions['driver'] = {
    identity: { instanceId: id(20), projectId: id(1), modelVersionId: id(2), loadId: id(21), sessionId: id(22) },
    assertCurrent: vi.fn(() => { if (flags.closed) throw Error('driver is closed'); }),
    discover: vi.fn(async (request: PreparationDiscoveryRequest): Promise<PreparationDiscoveryPage> => ({ schemaVersion: 'wfc.pf.viewer-discovery.v1',
      mode: request.mode, names: request.names, rootObjectId: request.rootObjectId, cursor: request.cursor,
      matchingPolicyVersion: 'wfc.pf.project-exact-candidates.v1', indexedObjectCount: flags.ambiguous ? 2 : 1, propertyScan: null,
      objects: (flags.ambiguous ? [3, 4] : [3]).map((objectId, orderIndex) => ({ objectId, parentId: null, name: '/B001', hasGeometry: true, isPhysicalLeaf: true,
        orderIndex, matchedNames: request.mode === 'names' ? [...request.names] : [] })), nextCursor: null, complete: true })),
    capture: vi.fn(async (request: ModelCaptureRequest) => {
      const slice = request.preparationSlice!;
      const proof = await createCompletedCaptureEvidence({ schemaVersion: 'wfc.pf.completed-capture-evidence.v1',
        binding: { projectId: id(1), modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), selectionRevision: null, loadId: flags.wrongEvidence ? id(99) : driver.identity.loadId,
          captureId: id(23), sessionId: slice.sessionId, partId: slice.partId, planSha256: slice.planSha256, coordinateFrameId: slice.coordinateFrameId, partPayloadSha256: null },
        observations: { sdkVersion: '7.130.0', matrixPrecision: 'binary64', sourceUnitLabel: observed('m'), metresPerDisplayUnit: observed(1), upVector: observed<[number, number, number]>([0, 0, 1]),
          globalOffsetDisplayUnits: observed<[number, number, number]>([0, 0, 0]), globalOffsetMetres: derived<[number, number, number]>([0, 0, 0]), displayToWorldMetres: derived(matrix),
          legacySourceToWorldMetres: derived(matrix), modelTransform: missing, placementTransform: missing, objectLocalFrame: null, sourceDocumentId: null, sourceInstancePath: null, stableExportEntityId: null },
        fragments: [{ objectId: 'dbid:3', fragmentId: 'fragment:3', originalWorldMatrix: observed(matrix), displayWorldMatrix: observed(matrix),
          canonicalMatrix: derived(matrix), transformAlreadyApplied: true }], diagnostics: ['SYNTHETIC_ONLY_NOT_ENGINEERING_ACCEPTANCE'] });
      return { snapshot: clone(snapshot), evidence: proof };
    }),
    close: vi.fn(async () => { events.push('driver-joined'); flags.closed = true; return { joined: true as const }; }),
  };
  const preparations: ManagedPreparationWorkflowOptions['preparations'] = {
    context: vi.fn(async () => clone(context)),
    get: vi.fn(async () => clone(session!)),
    create: vi.fn(async (_project: string, _who: OperationPrincipal, raw: unknown) => {
      const body = preparationCreateSchema.parse(raw);
      if (!session) {
        const plan = buildPreparationPlan(context, body, id(30));
        session = preparationSessionSchema.parse({ schemaVersion: 'wfc.pf.preparation-session.v2', id: plan.id, projectId: id(1), state: 'planned', sessionRevision: '0',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), principal: { kind: 'calculation-grant', actorId: authority.issuerId, grant },
          plan, parts: [], coverage: { expectedParts: plan.partPlan.length, committedParts: 0, requestedScopeComplete: false, missingPartIds: plan.partPlan.map(part => part.partId) },
          failure: null, publishedAggregateId: null, recovery: null });
      }
      if (flags.loseCreateAck) { flags.loseCreateAck = false; throw Error('private create transport details'); }
      return clone(session);
    }),
    upload: vi.fn(async (_project: string, _who: OperationPrincipal, sessionId: string, partId: string, planSha: string, raw: unknown) => {
      const value = snapshotSchema.parse(raw), part = session!.plan.partPlan.find(item => item.partId === partId)!, prior = session!.parts.find(item => item.partId === partId);
      const receipt = preparationPartReceiptSchema.parse({ schemaVersion: 'wfc.pf.preparation-part-receipt.v2', sessionRevision: '1', duplicate: Boolean(prior),
        part: prior ?? { schemaVersion: 'wfc.pf.preparation-part.v2', sessionId, partId, partIndex: part.partIndex, sessionPlanSha256: planSha,
          modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), coordinateFrameId: session!.plan.coordinateFrameId, scopeSha256: part.scopeSha256,
          payloadEncoding: 'pathfinder.model.snapshot.v1-json-utf8', payloadSha256: preparationDigest(value), payloadBytes: Buffer.byteLength(JSON.stringify(value)), payloadRef: id(31),
          counts: { objects: 1, physicalLeaves: 1, fragments: 1, vertices: 3, triangles: 1 }, coverage: { partScopeComplete: true, missingObjectIds: [], ambiguousObjectIds: [] },
          producer: { level: 'B', adapterVersion: value.capture.adapterVersion, sourceKind: 'synthetic', grant }, completedAt: new Date().toISOString() } });
      if (!prior) { (session!.parts as PreparationPart[]).push(receipt.part); session!.state = 'collecting'; session!.sessionRevision = '1'; session!.coverage = { expectedParts: 1, committedParts: 1, requestedScopeComplete: true, missingPartIds: [] }; }
      events.push('upload-committed'); if (flags.holdUpload) await flags.holdUpload;
      events.push('upload-returned'); if (flags.loseUploadAck) { flags.loseUploadAck = false; throw Error('private upload transport details'); }
      return receipt;
    }),
    publish: vi.fn(async () => {
      if (!published) {
        const plan = session!.plan;
        const aggregate = { ...plan, schemaVersion: 'wfc.pf.geometry-aggregate.v2', id: id(40), projectId: id(1), sessionId: plan.id, artifactId: id(41), geometryRevision: '1',
          sourceLocationRegistryRevision: plan.locationRegistryRevision, locationRegistryRevision: '5', coordinateFrameId: plan.coordinateFrameId, orderedPlanSha256: plan.orderedPlanSha256,
          orderedScopeSha256: plan.requestedScope.scopeSha256, partReferences: session!.parts.map(part => ({ partId: part.partId, partIndex: part.partIndex, payloadSha256: part.payloadSha256 })),
          projection: { schemaVersion: snapshot.schemaVersion, payloadRef: id(42), sha256: 'd'.repeat(64), bytes: 1000 }, traceIndex: { schemaVersion: 'wfc.pf.preparation-trace-index.v1', payloadRef: id(43), sha256: 'e'.repeat(64), bytes: 100 },
          counts: { objects: 1, physicalLeaves: 1, fragments: 1, vertices: 3, triangles: 1 }, requestedScopeComplete: true, wholePlantGeometry: false,
          engineVersion: 'synthetic-test', rulesVersion: 'unchanged-existing-rules', diagnostics: [], engineeringAccepted: false, nativeParity: 'not-performed', publishedAt: new Date().toISOString(), producerGrant: grant };
        // Aggregate contracts intentionally do not carry the full plan fields.
        for (const key of ['partitionAlgorithmVersion', 'matchingPolicyVersion', 'limitsProfile', 'requestedScope', 'partPlan', 'objectManifest', 'objectOrder'] as const) delete (aggregate as unknown as Record<string, unknown>)[key];
        published = preparationPublicationSchema.parse({ schemaVersion: 'wfc.pf.preparation-publication.v2', sessionId: plan.id, aggregate, duplicate: false });
        session!.state = 'published'; session!.sessionRevision = '2'; session!.publishedAggregateId = id(40);
        context = preparationContextSchema.parse({ ...context, schemaVersion: 'wfc.pf.preparation-context.v2', scope: { ...context.scope, locationRegistryRevision: '5' }, currentAggregate: (published as { aggregate: unknown }).aggregate });
      }
      if (flags.losePublishAck) { flags.losePublishAck = false; throw Error('private publication ACK'); }
      return preparationPublicationSchema.parse(published);
    }),
  };
  const traces: ManagedPreparationWorkflowOptions['traces'] = {
    evidencePut: vi.fn(async (_project: string, _who: OperationPrincipal, sessionId: string, partId: string, raw: unknown) => {
      const duplicate = evidence.has(partId); evidence.set(partId, clone(raw));
      if (flags.loseEvidenceAck) { flags.loseEvidenceAck = false; throw Error('private evidence ACK'); }
      return captureEvidenceReceiptSchema.parse({ schemaVersion: 'wfc.pf.capture-evidence-receipt.v1', sessionId, partId, duplicate,
        evidence: { payloadRef: id(32), sha256: '1'.repeat(64), bytes: 1000 } });
    }),
  };
  const options: ManagedPreparationWorkflowOptions = { authority, principal, driver, preparations, traces, uuid: () => id(nextId++),
    authorize: vi.fn(async () => { if (!flags.allowed) throw Object.assign(Error('private revoked role'), { code: 'CALCULATION_GRANT_REVOKED' }); }),
    recorder: { load: vi.fn(async () => clone(saved)), save: vi.fn(async value => { saved = clone(value); journal.push(clone(value)); }) } };
  const resume = (): ManagedPreparationWorkflowOptions => ({ ...options, driver: { ...driver, identity: { ...driver.identity, loadId: id(90) },
    capture: vi.fn(async request => {
      const captured = await driver.capture(request), { sha256: _sha, ...body } = captured.evidence;
      return { snapshot: captured.snapshot, evidence: await createCompletedCaptureEvidence({ ...body, binding: { ...body.binding, loadId: id(90) } }) };
    }), assertCurrent: vi.fn(), close: vi.fn(async () => ({ joined: true as const })) } });
  return { options, flags, events, journal, evidence, resume, get saved() { return saved; }, get session() { return session; },
    setContext(value: typeof context) { context = value; }, get context() { return context; } };
}

describe('managed calculation-grant preparation workflow with injected services only', () => {
  it('uses bounded shared discovery/capture contracts, exact evidence binding and immutable published output', async () => {
    const f = fixture(), result = await runManagedPreparationWorkflow(f.options);
    expect(result).toMatchObject({ status: 'published', producer: { joined: true }, aggregate: { schemaVersion: 'wfc.pf.geometry-aggregate.v2', engineeringAccepted: false, nativeParity: 'not-performed' } });
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.aggregate)).toBe(true);
    expect(f.options.driver.discover).toHaveBeenCalledTimes(2); expect(f.options.driver.capture).toHaveBeenCalledTimes(1);
    expect(f.journal.map(value => value.pending?.kind ?? 'confirmed')).toEqual(['create', 'confirmed', 'upload', 'evidence', 'confirmed', 'publish', 'confirmed']);
    const proof = (f.evidence.values().next().value as { evidence: Parameters<typeof verifyCompletedCaptureEvidence>[0] }).evidence;
    expect(await verifyCompletedCaptureEvidence(proof)).toBe(true);
    expect(proof).toMatchObject({ binding: { selectionRevision: '1', partPayloadSha256: f.session!.parts[0].payloadSha256, sessionId: result.sessionId } });
    const serialized = JSON.stringify(f.journal); expect(serialized).not.toContain('ownerToken'); expect(serialized).not.toContain('leaseId'); expect(serialized).not.toContain('loginId');
    expect(f.events.at(-1)).toBe('driver-joined'); expect(result.traceInputs.partIds).toEqual(f.session!.parts.map(part => part.partId));
  });

  it.each(['loseCreateAck', 'loseUploadAck', 'loseEvidenceAck', 'losePublishAck'] as const)('retains and replays the exact durable command after %s', async flag => {
    const f = fixture(); f.flags[flag] = true;
    await expect(runManagedPreparationWorkflow(f.options)).rejects.toMatchObject({ outcome: 'unknown' });
    expect(f.saved?.pending).not.toBeNull(); const retained = clone(f.saved!.pending);
    const result = await runManagedPreparationWorkflow(f.resume()); expect(result.status).toBe('published'); expect(f.saved?.pending).toBeNull();
    if (flag === 'loseCreateAck') {
      const calls = vi.mocked(f.options.preparations.create).mock.calls; expect(calls[0][2]).toEqual(calls[1][2]);
    } else if (flag === 'loseUploadAck') {
      const calls = vi.mocked(f.options.preparations.upload).mock.calls; expect(calls[0]).toEqual(calls[1]); expect(f.options.driver.capture).toHaveBeenCalledTimes(1);
      expect(retained?.kind).toBe('upload');
    } else if (flag === 'loseEvidenceAck') {
      const calls = vi.mocked(f.options.traces.evidencePut).mock.calls; expect(calls[0].slice(0, 5)).toEqual(calls[1].slice(0, 5)); expect(f.options.driver.capture).toHaveBeenCalledTimes(1);
    } else {
      const calls = vi.mocked(f.options.preparations.publish).mock.calls; expect(calls[0]).toEqual(calls[1]); expect(f.options.driver.capture).toHaveBeenCalledTimes(1);
    }
  });

  it('does not turn ambiguous tray roots into automatic resolutions or captured geometry', async () => {
    const f = fixture(); f.flags.ambiguous = true;
    await expect(runManagedPreparationWorkflow(f.options)).rejects.toMatchObject({ code: 'MANAGED_PREPARATION_PLAN_UNRESOLVED', outcome: 'refused', sessionId: id(30) });
    expect(f.options.driver.capture).not.toHaveBeenCalled(); expect(f.options.preparations.upload).not.toHaveBeenCalled(); expect(f.options.preparations.publish).not.toHaveBeenCalled();
    expect(f.session!.plan.diagnostics.some(value => value.code === 'TRAY_ROOT_AMBIGUOUS')).toBe(true); expect(f.options.driver.close).toHaveBeenCalledTimes(1);
  });

  it('refuses a different capture load before persisting a part intent', async () => {
    const f = fixture(); f.flags.wrongEvidence = true;
    await expect(runManagedPreparationWorkflow(f.options)).rejects.toMatchObject({ code: 'MANAGED_PREPARATION_EVIDENCE_SCOPE', outcome: 'refused' });
    expect(f.options.preparations.upload).not.toHaveBeenCalled(); expect(f.saved?.pending).toBeNull();
  });

  it('denies human or non-prepare authority without borrowing a login', async () => {
    const f = fixture();
    await expect(runManagedPreparationWorkflow({ ...f.options, principal: { userId: id(6), loginId: id(77), loginExpiresAt: Date.now() + 60000 } })).rejects.toMatchObject({ code: 'MANAGED_PREPARATION_AUTHORITY_DENIED' });
    expect(f.options.preparations.context).not.toHaveBeenCalled(); expect(f.options.driver.close).toHaveBeenCalledTimes(1);
    const g = fixture(), authority = { ...g.options.authority, operation: 'trace' as const };
    await expect(runManagedPreparationWorkflow({ ...g.options, authority, principal: grantOperationPrincipal(authority) })).rejects.toMatchObject({ code: 'MANAGED_PREPARATION_AUTHORITY_DENIED' });
  });

  it('rechecks authorization after capture and admits no subsequent write after revocation', async () => {
    const f = fixture(), capture = f.options.driver.capture;
    f.options.driver.capture = vi.fn(async request => { const value = await capture(request); f.flags.allowed = false; return value; });
    await expect(runManagedPreparationWorkflow(f.options)).rejects.toMatchObject({ code: 'CALCULATION_GRANT_REVOKED' });
    expect(f.options.preparations.upload).not.toHaveBeenCalled(); expect(f.options.driver.close).toHaveBeenCalledTimes(1);
  });

  it('retains an uncertain write and waits for its known completion before joining after deadline', async () => {
    const f = fixture(), held = deferred(); let clock = Date.now(); f.flags.holdUpload = held.promise;
    const work = runManagedPreparationWorkflow({ ...f.options, now: () => clock });
    await vi.waitFor(() => expect(f.events).toContain('upload-committed'));
    clock += 16 * 60000; expect(f.options.driver.close).not.toHaveBeenCalled(); held.resolve();
    await expect(work).rejects.toMatchObject({ code: 'MANAGED_PREPARATION_CANCELLED', outcome: 'unknown' });
    expect(f.events.indexOf('upload-returned')).toBeLessThan(f.events.indexOf('driver-joined')); expect(f.saved?.pending?.kind).toBe('upload');
  });

  it('requires an actual driver join and a current authority after the awaited join', async () => {
    const f = fixture(); f.options.driver.close = vi.fn(async () => { throw Error('private unknown helper join'); });
    await expect(runManagedPreparationWorkflow(f.options)).rejects.toMatchObject({ code: 'MANAGED_PREPARATION_JOIN_UNKNOWN' });
    const g = fixture(); g.options.driver.close = vi.fn(async () => { g.flags.allowed = false; return { joined: true as const }; });
    await expect(runManagedPreparationWorkflow(g.options)).rejects.toMatchObject({ code: 'CALCULATION_GRANT_REVOKED' });
    const h = fixture(); h.options.driver.close = vi.fn(async () => ({ joined: false as never }));
    await expect(runManagedPreparationWorkflow(h.options)).rejects.toMatchObject({ code: 'MANAGED_PREPARATION_JOIN_UNKNOWN' });
  });
  it.each(['joined', 'throw', 'unconfirmed'])('preserves an unjoined publication engine independently of browser close=%s', async browserClose => {
    const f = fixture(), fatal = new PathFinderError('ENGINE_SESSION_REAP_FAILED', 502);
    vi.mocked(f.options.preparations.publish).mockRejectedValueOnce(fatal);
    if (browserClose === 'throw') f.options.driver.close = vi.fn(async () => { throw new PathFinderError('MANAGED_PRODUCER_JOIN_UNKNOWN', 503); });
    if (browserClose === 'unconfirmed') f.options.driver.close = vi.fn(async () => ({ joined: false as never }));
    await expect(runManagedPreparationWorkflow(f.options)).rejects.toMatchObject({
      code: 'ENGINE_SESSION_REAP_FAILED', outcome: 'unknown', status: 503, cause: fatal,
    });
    expect(f.options.driver.close).toHaveBeenCalledTimes(1); expect(f.saved?.pending?.kind).toBe('publish');
  });
});
