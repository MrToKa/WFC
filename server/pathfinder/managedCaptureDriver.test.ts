// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createCompletedCaptureEvidence, verifyCompletedCaptureEvidence } from '../../viewer-runtime/capture-evidence.mjs';
import type { CaptureObservation, EvidencePoint } from '../../viewer-runtime/capture-evidence.mjs';
import { isModelCaptureInputAppend, isStagedModelCaptureStart } from '../../viewer-runtime/capture-input.mjs';
import type { ModelCaptureStagedStart } from '../../viewer-runtime/capture-input.mjs';
import type { BridgeEnvelope, ModelCaptureRequest } from '../../viewer-runtime/protocol.mjs';
import type { PreparationDiscoveryRequest, PreparationSlice } from '../../viewer-runtime/preparation-input.mjs';
import { createManagedCaptureDriver } from './managedCaptureDriver.js';

const id = (n: number) => `ed800000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const observation = <T>(status: 'observed' | 'derived', value: T): CaptureObservation<T> => ({ status, value, api: 'synthetic-driver-fixture', reason: null });
const discovery: PreparationDiscoveryRequest = { schemaVersion: 'wfc.pf.viewer-discovery.v1', mode: 'names', names: ['/B001'], rootObjectId: null, cursor: 0, limit: 128 };
function fixture() {
  const identity = { instanceId: id(1), projectId: id(2), modelVersionId: id(3), loadId: id(4), sessionId: id(5) }, controller = new AbortController();
  const request: ModelCaptureRequest = { equipmentNames: ['EQ01'], preparationSlice: { schemaVersion: 'wfc.pf.viewer-slice.v1', sessionId: id(20), partId: id(21), planSha256: 'b'.repeat(64), coordinateFrameId: id(22),
    objects: [{ objectId: 3, rootObjectId: 3, projectTrayId: id(23), routeName: '/B001', shapeName: 'Synthetic tray', allowedCategories: ['Control'] }], equipmentObjectIds: [] } };
  const flags = { replyIdentity: '' as string, badAck: '' as string, evidenceBinding: '' as string, badEvidenceHash: false, badScope: false, badEventIndex: false, earlyDone: false, lateDone: false };
  let start: ModelCaptureStagedStart & { preparationSlice: PreparationSlice } | undefined, names: string[] = [], events: Record<string, unknown>[] | undefined;
  const reply = (envelope: BridgeEnvelope, type: string, payload: Record<string, unknown>): BridgeEnvelope => ({ ...envelope, type, payload,
    ...(flags.replyIdentity ? { [flags.replyIdentity]: id(99) } : {}) });
  const buildEvents = async () => {
    const captureId = start!.captureId, inputScope = { ...start!.input, propertyScan: { indexedObjectCount: 1, attemptedObjectCount: 1, returnedObjectCount: 1, omittedObjectCount: 0, complete: true } };
    const evidence = await createCompletedCaptureEvidence({ schemaVersion: 'wfc.pf.completed-capture-evidence.v1', binding: { projectId: identity.projectId, modelVersionId: identity.modelVersionId,
      contentFingerprint: 'a'.repeat(64), selectionRevision: null, loadId: identity.loadId, captureId, sessionId: request.preparationSlice!.sessionId, partId: request.preparationSlice!.partId,
      planSha256: request.preparationSlice!.planSha256, coordinateFrameId: request.preparationSlice!.coordinateFrameId, partPayloadSha256: null,
      ...(flags.evidenceBinding ? { [flags.evidenceBinding]: flags.evidenceBinding === 'planSha256' ? 'f'.repeat(64) : id(99) } : {}) },
      observations: { sdkVersion: '7.130.0', matrixPrecision: 'binary64', sourceUnitLabel: observation('observed', 'm'), metresPerDisplayUnit: observation('observed', 1), upVector: observation<EvidencePoint>('observed', [0, 0, 1]),
        globalOffsetDisplayUnits: observation<EvidencePoint>('observed', [0, 0, 0]), globalOffsetMetres: observation<EvidencePoint>('derived', [0, 0, 0]), displayToWorldMetres: observation('derived', matrix), legacySourceToWorldMetres: observation('derived', matrix),
        modelTransform: { status: 'unavailable', value: null, api: 'synthetic-driver-fixture', reason: 'NOT_OBSERVED' }, placementTransform: { status: 'unavailable', value: null, api: 'synthetic-driver-fixture', reason: 'NOT_OBSERVED' },
        objectLocalFrame: null, sourceDocumentId: null, sourceInstancePath: null, stableExportEntityId: null },
      fragments: [{ objectId: 'dbid:3', fragmentId: 'fragment:1', originalWorldMatrix: observation('observed', matrix), displayWorldMatrix: observation('observed', matrix), canonicalMatrix: observation('derived', matrix), transformAlreadyApplied: true }], diagnostics: ['SYNTHETIC_ONLY'] });
    if (flags.badEvidenceHash) evidence.sha256 = 'f'.repeat(64);
    const counts = { objectCount: 1, fragmentCount: 1, vertexCount: 3, triangleCount: 1 };
    const summary = { engineeringAccepted: false, counts, scope: { preparationSlice: start!.preparationSlice, equipmentNames: names, inputScope, indexedObjectCount: 1, fullPropertyScan: true }, completedEvidence: evidence };
    if (flags.badScope) summary.scope.inputScope.scopeSha256 = 'f'.repeat(64);
    const object = { id: 'dbid:3', parentId: null, dbId: 3, name: '/B001', geometryRole: 'routing-leaf', leafToRootNames: ['/B001'], properties: [], nativeHidden: null, planningExcluded: false,
      categoryAssignmentSource: 'explicit-planning', allowedCategories: ['Control'], routeName: '/B001', shapeName: 'Synthetic tray', bounds: { minimum: [0, 0, 0], maximum: [1, 1, 0] },
      fragments: [{ id: 'fragment:1', vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], triangleIndices: [0, 1, 2], fragmentToWorldMetres: matrix, transformAlreadyApplied: true }] };
    return [{ type: 'metadata', captureId, schemaVersion: 'pathfinder.model.capture.events.v1', scope: 'explicit-selected-network', inventoryComplete: false, geometryComplete: false,
      snapshotHeader: { schemaVersion: 'pathfinder.model.snapshot.v1', model: { projectId: identity.projectId, modelVersionId: identity.modelVersionId, contentSha256: 'a'.repeat(64) },
        capture: { adapterVersion: 'wfc.protected-selected-capture.v1', sourceKind: 'converted', inventoryComplete: false, geometryComplete: false, unitsVerified: false, transformsVerified: false, planningVisibilityKnown: false,
          sourceLinkVerified: false, evidenceSha256: ['c'.repeat(64)], inputScope: { ...start!.input, propertyScan: null } },
        coordinates: { vertexFrame: 'canonical-world-metres', sourceUnits: 'm', metresPerSourceUnit: 1, sourceToWorldMetres: matrix, displayToWorldMetres: matrix, globalOffsetMetres: [0, 0, 0] } } },
    { type: 'object-part', captureId, objectId: 'dbid:3', partIndex: 0, final: true, text: JSON.stringify(object) },
    { type: 'summary-part', captureId, partIndex: 0, final: true, text: JSON.stringify(summary) }, { type: 'complete', captureId, ...counts, engineeringAccepted: false }];
  };
  const exchange = vi.fn(async (envelope: BridgeEnvelope) => {
    if (envelope.type === 'READ_PREPARATION_OBJECTS') return reply(envelope, 'PREPARATION_OBJECTS', { schemaVersion: envelope.payload.schemaVersion, mode: envelope.payload.mode, names: envelope.payload.names,
      rootObjectId: envelope.payload.rootObjectId, cursor: envelope.payload.cursor, matchingPolicyVersion: 'wfc.pf.project-exact-candidates.v1', indexedObjectCount: 1, propertyScan: null, objects: [], nextCursor: null, complete: true });
    if (envelope.type === 'START_MODEL_CAPTURE') {
      if (!isStagedModelCaptureStart(envelope.payload) || !('preparationSlice' in envelope.payload)) throw new Error('Synthetic preparation fixture requires a valid staged preparation start');
      start = envelope.payload; names = [];
    }
    if (envelope.type === 'START_MODEL_CAPTURE' || 'equipmentOffset' in envelope.payload) {
      if ('equipmentOffset' in envelope.payload) {
        if (!isModelCaptureInputAppend(envelope.payload)) throw new Error('Synthetic preparation fixture requires a valid input append');
        names.push(...envelope.payload.equipmentNames);
      }
      const ready = names.length === start!.input.equipmentNameCount;
      return reply(envelope, 'MODEL_CAPTURE_INPUT_ACK', { captureId: flags.badAck === 'capture' ? id(99) : start!.captureId, phase: ready ? 'ready' : 'receiving',
        receivedNameCount: flags.badAck === 'count' ? names.length + 1 : names.length, scopeSha256: ready ? start!.input.scopeSha256 : null, equipmentNamesSha256: ready ? start!.input.equipmentNamesSha256 : null });
    }
    events ??= await buildEvents(); const index = envelope.payload.index;
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index >= events.length) throw new Error('Synthetic preparation fixture requires a bounded event index');
    const event = events[index];
    return reply(envelope, 'MODEL_CAPTURE_EVENT', { captureId: start!.captureId, index: flags.badEventIndex ? index + 1 : index,
      done: flags.earlyDone || event.type === 'complete' && !flags.lateDone, eventJson: JSON.stringify(event) });
  });
  const close = vi.fn(async (): Promise<{ joined: true }> => ({ joined: true }));
  const driver = createManagedCaptureDriver({ identity, contentFingerprint: 'a'.repeat(64), selectionRevision: '7', signal: controller.signal, exchange, close });
  return { identity, controller, request, flags, exchange, close, driver };
}

describe('protected managed capture driver scope and completion', () => {
  it('uses the existing protected discovery page contract', async () => {
    const f = fixture(); await expect(f.driver.discover(discovery)).resolves.toMatchObject({ mode: 'names', names: ['/B001'], complete: true });
    expect(f.exchange.mock.calls[0][0].type).toBe('READ_PREPARATION_OBJECTS');
  });
  it('uses the four-field bridge identity, staged input and actual assembler/evidence validators', async () => {
    const f = fixture(), result = await f.driver.capture(f.request);
    expect(result.snapshot.objects).toHaveLength(1); expect(await verifyCompletedCaptureEvidence(result.evidence)).toBe(true);
    expect(result.evidence.binding).toMatchObject({ selectionRevision: '7', loadId: f.identity.loadId, sessionId: f.request.preparationSlice!.sessionId, partId: f.request.preparationSlice!.partId });
    expect(result.evidence.binding.sessionId).not.toBe(f.identity.sessionId); expect(f.exchange.mock.calls.every(([message]) => !('sessionId' in message))).toBe(true);
    expect(f.exchange.mock.calls[0][0].type).toBe('START_MODEL_CAPTURE'); expect(f.exchange.mock.calls[1][0].payload.equipmentNames).toEqual(['EQ01']);
  });
  it.each(['instanceId', 'projectId', 'modelVersionId', 'loadId'])('rejects a response for another %s', async field => {
    const f = fixture(); f.flags.replyIdentity = field; await expect(f.driver.capture(f.request)).rejects.toMatchObject({ code: 'MANAGED_CAPTURE_RESPONSE_INVALID' });
  });
  it.each(['capture', 'count'])('requires exact staged input acknowledgement %s', async badAck => {
    const f = fixture(); f.flags.badAck = badAck; await expect(f.driver.capture(f.request)).rejects.toMatchObject({ code: 'MANAGED_CAPTURE_INPUT_MISMATCH' });
  });
  it.each(['loadId', 'sessionId', 'partId', 'planSha256', 'coordinateFrameId'])('rejects valid-hash evidence bound to another %s', async field => {
    const f = fixture(); f.flags.evidenceBinding = field; await expect(f.driver.capture(f.request)).rejects.toMatchObject({ code: 'MANAGED_CAPTURE_EVIDENCE_MISMATCH' });
  });
  it('refuses an unverified evidence digest', async () => {
    const f = fixture(); f.flags.badEvidenceHash = true; await expect(f.driver.capture(f.request)).rejects.toMatchObject({ code: 'MANAGED_CAPTURE_EVIDENCE_MISMATCH' });
  });
  it('retains the pure assembler input-scope closure guard', async () => {
    const f = fixture(); f.flags.badScope = true; await expect(f.driver.capture(f.request)).rejects.toThrow(/scope closure/);
  });
  it.each(['badEventIndex', 'earlyDone', 'lateDone'] as const)('does not publish capture on %s', async flag => {
    const f = fixture(); f.flags[flag] = true; await expect(f.driver.capture(f.request)).rejects.toMatchObject({ code: flag === 'badEventIndex' ? 'MANAGED_CAPTURE_EVENT_MISMATCH' : 'MANAGED_CAPTURE_COMPLETION_MISMATCH' });
  });
  it('rejects lookup capture and pre-aborted work before any exchange', async () => {
    const f = fixture(); await expect(f.driver.capture({ lookupRouteCodes: ['/B001'], equipmentNames: [] })).rejects.toMatchObject({ code: 'MANAGED_CAPTURE_PREPARATION_ONLY' });
    f.controller.abort(); await expect(f.driver.capture(f.request)).rejects.toBeDefined(); expect(f.exchange).not.toHaveBeenCalled();
    await expect(f.driver.close()).resolves.toEqual({ joined: true }); expect(f.close).toHaveBeenCalledOnce();
  });
  it('rechecks cancellation after a reply and allows independent cleanup with no new data commands', async () => {
    const f = fixture(), original = f.exchange.getMockImplementation()!;
    f.exchange.mockImplementationOnce(async message => { const reply = await original(message); f.controller.abort(); return reply; });
    await expect(f.driver.capture(f.request)).rejects.toBeDefined(); await f.driver.close(); expect(f.exchange).toHaveBeenCalledOnce();
  });
  it('does not convert an unknown cleanup join into joined:true', async () => {
    const f = fixture(); f.close.mockRejectedValueOnce(Object.assign(new Error('Synthetic unknown join'), { code: 'PRODUCER_JOIN_UNKNOWN' }));
    await expect(f.driver.close()).rejects.toMatchObject({ code: 'PRODUCER_JOIN_UNKNOWN' }); expect(() => f.driver.assertCurrent()).toThrow();
  });
});
