import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy';
import { cableEndpointCommandSchema, cableEndpointContextSchema, cableEndpointContextHashInput, type CableEndpointCommand } from '../../shared/pathfinderCableEndpoints';
import { endpointBindingContentHashInput, type EndpointBinding } from '../../shared/pathfinderEndpointBindings';
import { fetchCableEndpointContext, fetchCableEndpointSelection, saveCableEndpoint, closePendingCableEndpoint, CABLE_ENDPOINT_REQUEST_MILLISECONDS } from './pathfinderCableEndpoints';

const id = (n: number) => `70000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const project = id(1), actor = id(2), cable = id(3), hash = 'a'.repeat(64);
const digest = (value: unknown) => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
function context() {
  const result = cableEndpointContextSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-context.v1', projectId: project, cableId: cable, end: 'from', cableWriteRevision: '4',
    logicalName: 'LP-001', logicalKey: 'LP-001', mto: 'Instrumentation', canBind: true, reasonCodes: [], registryRevision: '5', location: null, head: null,
    current: { modelVersionId: id(4), selectionRevision: '6', contentFingerprint: 'b'.repeat(64), aggregateId: id(5), artifactId: id(6), projectionSha256: 'c'.repeat(64), captureFrameId: id(7), geometryRevision: '7', traceId: id(8) }, contextSha256: hash });
  result.contextSha256 = digest(cableEndpointContextHashInput(result)); return result;
}
function command(): CableEndpointCommand {
  const scope = context(); return cableEndpointCommandSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-command.v1', idempotencyKey: id(9), expectedContextSha256: scope.contextSha256,
    expectedCableWriteRevision: scope.cableWriteRevision, expectedLogicalName: scope.logicalName, expectedRegistryRevision: scope.registryRevision,
    expectedLocationId: null, expectedLocationRevision: null, expectedHeadId: null, expectedCurrent: scope.current, reason: 'Confirmed logical location',
    selection: { mode: 'fixed-world', pointProjectMetres: [1, 2, 3], derivation: 'manual-world-point', displaySdkObjectId: null } });
}
function receipt(input = command()) {
  const current = input.expectedCurrent, selection = input.selection;
  const binding: EndpointBinding = { schemaVersion: 'wfc.pf.endpoint-binding.v1', id: id(10), projectId: project, locationId: id(11), locationRevision: '1', bindingRevision: '1', locationRegistryRevision: '6',
    modelVersionId: current.modelVersionId, aggregateId: current.aggregateId, artifactId: current.artifactId, projectionSha256: current.projectionSha256, captureFrameId: current.captureFrameId,
    qualifiedProjectFrameId: null, status: 'confirmed', mode: selection.mode, pointProjectMetres: selection.mode === 'fixed-world' ? selection.pointProjectMetres : [1, 2, 3],
    derivation: selection.mode === 'fixed-world' ? selection.derivation : 'equipment-bottom-aabb.v1', sourceObject: selection.mode === 'fixed-world' ? null : selection.object,
    attachment: null, sourceDecisionId: null, supersedesBindingId: null, legacyObservationId: null, priorPointProjectMetres: null, priorCaptureFrameId: null, displacementBasis: 'none',
    displacementVectorMetres: null, displacementMetres: null, confirmedBy: actor, confirmedAt: '2026-10-20T00:00:00Z', reason: input.reason, contentSha256: hash };
  binding.contentSha256 = digest(endpointBindingContentHashInput(binding));
  return { schemaVersion: 'wfc.pf.cable-endpoint-receipt.v1', projectId: project, actorId: actor, cableId: cable, end: 'from', logicalName: 'LP-001', idempotencyKey: input.idempotencyKey,
    commandSha256: digest(input), expectedCableWriteRevision: input.expectedCableWriteRevision, expectedContextSha256: input.expectedContextSha256, locationId: id(11),
    binding: { schemaVersion: 'wfc.pf.endpoint-binding-receipt.v1', projectId: project, locationId: id(11), registryRevision: '6', locationRevision: '1', binding, duplicate: false },
    impact: { fromOccurrences: 1, toOccurrences: 1, distinctCables: 1, cableIds: [cable] }, duplicate: false };
}
function closure(input = command()) { return { schemaVersion: 'wfc.pf.cable-endpoint-recovery.v1', status: 'closed', closure: {
  schemaVersion: 'wfc.pf.cable-endpoint-closed.v1', actorId: actor, projectId: project, cableId: cable, end: 'from', idempotencyKey: input.idempotencyKey,
  commandSha256: digest(input), expectedContextSha256: input.expectedContextSha256, expectedCableWriteRevision: input.expectedCableWriteRevision } }; }
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('exact cable endpoint transport and recovery', () => {
  it('verifies owned context and exact retained selection using fixed GET paths', async () => {
    const scope = context(), selected = { schemaVersion: 'wfc.pf.cable-endpoint-selection-response.v1', projectId: project, cableId: cable, end: 'from', contextSha256: scope.contextSha256,
      selection: { schemaVersion: 'wfc.pf.cable-endpoint-selection.v1', projectId: project, current: scope.current, sdkObjectId: 99999, status: 'available', reasonCodes: [],
        object: { traceId: id(8), objectRevisionId: id(20), recordSha256: hash }, pointProjectMetres: [1, 2, 3], bounds: { minimum: [0, 1, 3], maximum: [2, 3, 5] }, approximate: true, derivation: 'equipment-bottom-aabb.v1' } };
    vi.mocked(fetch).mockResolvedValueOnce(response(scope)).mockResolvedValueOnce(response(selected));
    await expect(fetchCableEndpointContext(project, 'token', cable, 'from')).resolves.toEqual(scope);
    await expect(fetchCableEndpointSelection(project, 'token', scope, 99999)).resolves.toEqual(selected);
    expect(vi.mocked(fetch).mock.calls[1][0]).toContain(`/cable-endpoints/${cable}/from/selection?sdkObjectId=99999&contextSha256=${scope.contextSha256}`);
    for (const [, options] of vi.mocked(fetch).mock.calls) { expect(options).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error', headers: { Authorization: 'Bearer token' } }); expect(options).not.toHaveProperty('body'); }
  });
  it('accepts explicit unavailable retained evidence without fabricating a point or source object', async () => {
    const scope = context(), selected = { schemaVersion: 'wfc.pf.cable-endpoint-selection-response.v1', projectId: project, cableId: cable, end: 'from', contextSha256: scope.contextSha256,
      selection: { schemaVersion: 'wfc.pf.cable-endpoint-selection.v1', projectId: project, current: scope.current, sdkObjectId: 44, status: 'unavailable', reasonCodes: ['OBJECT_NOT_RETAINED'], object: null, pointProjectMetres: null, bounds: null, approximate: true, derivation: null } };
    vi.mocked(fetch).mockResolvedValueOnce(response(selected)); await expect(fetchCableEndpointSelection(project, 'token', scope, 44)).resolves.toEqual(selected);
  });
  it('rejects selection replies for a different SDK object, model, endpoint or context', async () => {
    const current = context(), base = { schemaVersion: 'wfc.pf.cable-endpoint-selection-response.v1', projectId: project, cableId: cable, end: 'from', contextSha256: current.contextSha256,
      selection: { schemaVersion: 'wfc.pf.cable-endpoint-selection.v1', projectId: project, current: current.current, sdkObjectId: 44, status: 'unavailable', reasonCodes: ['OBJECT_NOT_RETAINED'], object: null, pointProjectMetres: null, bounds: null, approximate: true, derivation: null } };
    for (const result of [{ ...base, end: 'to' }, { ...base, contextSha256: 'f'.repeat(64) }, { ...base, selection: { ...base.selection, sdkObjectId: 45 } },
      { ...base, selection: { ...base.selection, current: { ...current.current, modelVersionId: id(99) } } }]) {
      vi.mocked(fetch).mockResolvedValueOnce(response(result)); await expect(fetchCableEndpointSelection(project, 'token', current, 44)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });
  it('sends the exact strict PUT and verifies command hash, actor, logical name, binding and impact', async () => {
    const input = command(), result = receipt(input); vi.mocked(fetch).mockResolvedValueOnce(response(result));
    await expect(saveCableEndpoint(project, 'token', cable, 'from', input, actor)).resolves.toEqual(result);
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ method: 'PUT', body: JSON.stringify(input), headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' } });
    expect(input.expectedLogicalName).toBe('LP-001'); expect(input.selection).not.toHaveProperty('object');
  });
  it('accepts a no-op shared binding previously confirmed by another administrator while verifying the new command actor', async () => {
    const result = receipt(); result.binding.binding.confirmedBy = id(88); result.binding.binding.reason = 'Historical shared binding';
    result.binding.binding.contentSha256 = digest(endpointBindingContentHashInput(result.binding.binding));
    vi.mocked(fetch).mockResolvedValueOnce(response(result)); await expect(saveCableEndpoint(project, 'token', cable, 'from', command(), actor)).resolves.toEqual(result);
  });
  it('requires the exact retained immutable object reference for an object-derived save', async () => {
    const input = { ...command(), selection: { mode: 'object-derived' as const, sdkObjectId: 44, object: { traceId: id(8), objectRevisionId: id(20), recordSha256: hash } } };
    const correct = receipt(input); vi.mocked(fetch).mockResolvedValueOnce(response(correct));
    await expect(saveCableEndpoint(project, 'token', cable, 'from', input, actor)).resolves.toEqual(correct);
    const changed = receipt(input); changed.binding.binding.sourceObject!.objectRevisionId = id(99); changed.binding.binding.contentSha256 = digest(endpointBindingContentHashInput(changed.binding.binding));
    vi.mocked(fetch).mockResolvedValueOnce(response(changed)); await expect(saveCableEndpoint(project, 'token', cable, 'from', input, actor)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('verifies explicit POST close and already-saved recovery against the identical retained command', async () => {
    const input = command(), closed = closure(input), saved = { schemaVersion: 'wfc.pf.cable-endpoint-recovery.v1', status: 'saved', receipt: receipt(input) };
    vi.mocked(fetch).mockResolvedValueOnce(response(closed)).mockResolvedValueOnce(response(saved));
    await expect(closePendingCableEndpoint(project, 'new-login', cable, 'from', input, actor)).resolves.toEqual(closed);
    await expect(closePendingCableEndpoint(project, 'new-login', cable, 'from', input, actor)).resolves.toEqual(saved);
    for (const [url, options] of vi.mocked(fetch).mock.calls) { expect(url).toContain(`/from/close-pending`); expect(options).toMatchObject({ method: 'POST', body: JSON.stringify(input) }); }
  });
  it.each(['actor', 'key', 'hash', 'cable', 'revision', 'context'] as const)('refuses a mismatched closed disposition: %s', async field => {
    const result = closure(); const wrong = field === 'actor' ? { actorId: id(90) } : field === 'key' ? { idempotencyKey: id(90) } : field === 'hash' ? { commandSha256: 'f'.repeat(64) }
      : field === 'cable' ? { cableId: id(90) } : field === 'revision' ? { expectedCableWriteRevision: '900' } : { expectedContextSha256: 'f'.repeat(64) };
    vi.mocked(fetch).mockResolvedValueOnce(response({ ...result, closure: { ...result.closure, ...wrong } }));
    await expect(closePendingCableEndpoint(project, 'token', cable, 'from', command(), actor)).rejects.toMatchObject({ code: 'INVALID_RESPONSE', outcome: 'unknown' });
  });
  it('rejects foreign context, wrong SDK lookup/current frame and malformed or mismatched save evidence', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ ...context(), cableId: id(90) }));
    await expect(fetchCableEndpointContext(project, 'token', cable, 'from')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    for (const wrong of [{ actorId: id(90) }, { commandSha256: 'f'.repeat(64) }, { end: 'to' }, { logicalName: 'Object display name' }]) {
      vi.mocked(fetch).mockResolvedValueOnce(response({ ...receipt(), ...wrong }));
      await expect(saveCableEndpoint(project, 'token', cable, 'from', command(), actor)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
    const badPoint = receipt(); badPoint.binding.binding.pointProjectMetres = [8, 9, 10]; badPoint.binding.binding.contentSha256 = digest(endpointBindingContentHashInput(badPoint.binding.binding));
    vi.mocked(fetch).mockResolvedValueOnce(response(badPoint)); await expect(saveCableEndpoint(project, 'token', cable, 'from', command(), actor)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('refuses malformed route IDs, SDK IDs, commands and unknown fields before dispatch', async () => {
    await expect(fetchCableEndpointContext(project, 'token', '../cable', 'from')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(fetchCableEndpointSelection(project, 'token', context(), 0)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(saveCableEndpoint(project, 'token', cable, 'from', { ...command(), token: 'not allowed' } as never, actor)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(closePendingCableEndpoint(project, 'token', cable, 'from', command(), 'not-an-actor')).rejects.toMatchObject({ code: 'INVALID_REQUEST' }); expect(fetch).not.toHaveBeenCalled();
  });
  it('preserves unknown write outcomes and current authority failures without displaying arbitrary server messages', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ schemaVersion: 'wfc.pf.cable-endpoint-error.v1', code: 'CONTEXT_CHANGED', message: 'private names', outcome: 'refused' }, 409))
      .mockResolvedValueOnce(new Response(new ReadableStream(), { status: 403 }));
    await expect(saveCableEndpoint(project, 'token', cable, 'from', command(), actor)).rejects.toMatchObject({ status: 409, outcome: 'refused' });
    await expect(saveCableEndpoint(project, 'token', cable, 'from', command(), actor)).rejects.toMatchObject({ status: 403, outcome: 'unknown' });
  });
  it('bounds body bytes, invalid UTF8, duplicate keys and stalled reads without treating a write as failed', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new Uint8Array(1024 * 1024 + 1)))
      .mockResolvedValueOnce(new Response(new Uint8Array([0xff])))
      .mockResolvedValueOnce(new Response('{"projectId":"a","project\\u0049d":"b"}'));
    for (let n = 0; n < 3; n++) await expect(saveCableEndpoint(project, 'token', cable, 'from', command(), actor)).rejects.toMatchObject({ code: 'INVALID_RESPONSE', outcome: 'unknown' });
    vi.useFakeTimers(); vi.mocked(fetch).mockResolvedValueOnce(new Response(new ReadableStream()));
    const pending = expect(saveCableEndpoint(project, 'token', cable, 'from', command(), actor)).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT', outcome: 'unknown' });
    await vi.advanceTimersByTimeAsync(CABLE_ENDPOINT_REQUEST_MILLISECONDS); await pending;
  });
});
