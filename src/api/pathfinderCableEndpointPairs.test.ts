import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy';
import { cableEndpointPairCommandSchema, type CableEndpointPairCommand } from '../../shared/pathfinderCableEndpointPair';
import { endpointBindingContentHashInput, type EndpointBinding } from '../../shared/pathfinderEndpointBindings';
import { saveCableEndpointPair, closePendingCableEndpointPair } from './pathfinderCableEndpointPairs';

const id = (n: number) => `71000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const project = id(1), actor = id(2), cable = id(3), hash = 'a'.repeat(64);
const digest = (value: unknown) => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
function command(): CableEndpointPairCommand {
  const current = { modelVersionId: id(4), selectionRevision: '6', contentFingerprint: 'b'.repeat(64), aggregateId: id(5),
    artifactId: id(6), projectionSha256: 'c'.repeat(64), captureFrameId: id(7), geometryRevision: '7', traceId: id(8) };
  return cableEndpointPairCommandSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-pair-command.v1', idempotencyKey: id(9),
    expectedContexts: { from: hash, to: 'b'.repeat(64) }, endpoints: (['from', 'to'] as const).map((end, index) => ({ end, command: {
      schemaVersion: 'wfc.pf.cable-endpoint-command.v3', idempotencyKey: id(10 + index),
      expectedContextSha256: index ? 'b'.repeat(64) : hash, expectedCableWriteRevision: '4', expectedLogicalName: `LP-00${index + 1}`,
      expectedRegistryRevision: '5', expectedLocationId: null, expectedLocationRevision: null, expectedHeadId: null, expectedCurrent: current,
      reason: 'Explicit shared equipment selection', calculation: { preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, timeoutMilliseconds: 60000 },
      initialFill: { mode: 'when-both-empty' }, selection: index ? { mode: 'fixed-world', pointProjectMetres: [4, 5, 6], derivation: 'manual-world-point', displaySdkObjectId: null }
        : { mode: 'object-derived', sdkObjectId: 123, object: { traceId: id(8), objectRevisionId: id(20), recordSha256: hash } },
    } })) });
}
function receipt(input = command()) {
  return { schemaVersion: 'wfc.pf.cable-endpoint-pair-receipt.v1', projectId: project, actorId: actor, cableId: cable,
    idempotencyKey: input.idempotencyKey, commandSha256: digest(input), expectedCableWriteRevision: '4', expectedContexts: input.expectedContexts,
    finalRegistryRevision: '7', duplicate: false, receipts: input.endpoints.map((entry, index) => {
      const selected = entry.command.selection, current = entry.command.expectedCurrent, locationId = id(30 + index), registryRevision = String(6 + index);
      const binding: EndpointBinding = { schemaVersion: 'wfc.pf.endpoint-binding.v1', id: id(40 + index), projectId: project, locationId,
        locationRevision: '1', bindingRevision: '1', locationRegistryRevision: registryRevision, modelVersionId: current.modelVersionId,
        aggregateId: current.aggregateId, artifactId: current.artifactId, projectionSha256: current.projectionSha256, captureFrameId: current.captureFrameId,
        qualifiedProjectFrameId: null, status: 'confirmed', mode: selected.mode,
        pointProjectMetres: selected.mode === 'fixed-world' ? selected.pointProjectMetres : [1, 2, 3],
        derivation: selected.mode === 'fixed-world' ? selected.derivation : 'equipment-bottom-aabb.v1', sourceObject: selected.mode === 'fixed-world' ? null : selected.object,
        attachment: null, sourceDecisionId: null, supersedesBindingId: null, legacyObservationId: null, priorPointProjectMetres: null, priorCaptureFrameId: null,
        displacementBasis: 'none', displacementVectorMetres: null, displacementMetres: null, confirmedBy: actor,
        confirmedAt: '2026-10-20T00:00:00Z', reason: entry.command.reason, contentSha256: hash };
      binding.contentSha256 = digest(endpointBindingContentHashInput(binding));
      return { schemaVersion: 'wfc.pf.cable-endpoint-receipt.v1', projectId: project, actorId: actor, cableId: cable, end: entry.end,
        logicalName: entry.command.expectedLogicalName!, idempotencyKey: entry.command.idempotencyKey, commandSha256: digest(entry.command),
        expectedCableWriteRevision: '4', expectedContextSha256: entry.command.expectedContextSha256, locationId,
        binding: { schemaVersion: 'wfc.pf.endpoint-binding-receipt.v1', projectId: project, locationId, registryRevision, locationRevision: '1', binding, duplicate: false },
        impact: { fromOccurrences: 1, toOccurrences: 1, distinctCables: 1, cableIds: [cable] },
        locationImpact: { id: id(50 + index), status: entry.command.calculation === null ? 'blocked' : 'pending', eligibleCables: 1, excludedMvCables: 0, blockedCategoryCables: 0 },
        ...(entry.command.initialFill ? { initialFillMandate: { id: id(60 + index), contentSha256: 'd'.repeat(64), impactId: id(50 + index), mode: 'when-both-empty' } } : {}), duplicate: false };
    }) };
}
function closed(input = command()) { return { schemaVersion: 'wfc.pf.cable-endpoint-pair-recovery.v1', status: 'closed', closure: {
  schemaVersion: 'wfc.pf.cable-endpoint-pair-closed.v1', projectId: project, actorId: actor, cableId: cable, idempotencyKey: input.idempotencyKey,
  commandSha256: digest(input), expectedCableWriteRevision: '4', expectedContexts: input.expectedContexts } }; }
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('atomic cable endpoint pair transport', () => {
  it('sends one exact ordered PUT for both drafts and verifies every immutable child proof', async () => {
    const input = command(), result = receipt(input); vi.mocked(fetch).mockResolvedValueOnce(response(result));
    await expect(saveCableEndpointPair(project, 'current-token', cable, input, actor)).resolves.toEqual(result);
    expect(fetch).toHaveBeenCalledOnce(); expect(vi.mocked(fetch).mock.calls[0]).toEqual([expect.stringContaining(`/cable-endpoint-pairs/${cable}`),
      expect.objectContaining({ method: 'PUT', body: JSON.stringify(input), credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { Authorization: 'Bearer current-token', 'Content-Type': 'application/json' } })]);
    expect(vi.mocked(fetch).mock.calls[0][1]?.body).not.toContain('reviewId');
  });
  it('supports an explicit single-end draft while freezing both original endpoint contexts', async () => {
    const input = command(); input.endpoints = [input.endpoints[1]]; const result = receipt(input);
    vi.mocked(fetch).mockResolvedValueOnce(response(result)); await expect(saveCableEndpointPair(project, 'token', cable, input, actor)).resolves.toEqual(result);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).expectedContexts).toEqual(input.expectedContexts);
  });
  it.each(['actor', 'project', 'cable', 'key', 'hash', 'revision', 'context', 'order', 'missing-child', 'registry'] as const)('refuses mismatched outer pair proof: %s', async field => {
    const result = receipt();
    if (field === 'actor') result.actorId = id(90); if (field === 'project') result.projectId = id(90); if (field === 'cable') result.cableId = id(90);
    if (field === 'key') result.idempotencyKey = id(90); if (field === 'hash') result.commandSha256 = 'f'.repeat(64);
    if (field === 'revision') result.expectedCableWriteRevision = '999'; if (field === 'context') result.expectedContexts = { ...result.expectedContexts, to: 'f'.repeat(64) };
    if (field === 'order') result.receipts.reverse(); if (field === 'missing-child') result.receipts.pop(); if (field === 'registry') result.finalRegistryRevision = '5';
    vi.mocked(fetch).mockResolvedValueOnce(response(result)); await expect(saveCableEndpointPair(project, 'token', cable, command(), actor)).rejects.toMatchObject({ code: 'INVALID_RESPONSE', outcome: 'unknown' });
  });
  it.each(['actor', 'key', 'hash', 'end', 'context', 'logical-name', 'model', 'object', 'point', 'binding-hash', 'impact', 'mandate', 'mandate-impact'] as const)('refuses a changed child proof: %s', async field => {
    const result = receipt(), child = result.receipts[0], binding = child.binding.binding;
    if (field === 'actor') child.actorId = id(90); if (field === 'key') child.idempotencyKey = id(90); if (field === 'hash') child.commandSha256 = 'f'.repeat(64);
    if (field === 'end') child.end = 'to'; if (field === 'context') child.expectedContextSha256 = 'f'.repeat(64); if (field === 'logical-name') child.logicalName = 'Other cable label';
    if (field === 'model') binding.modelVersionId = id(90); if (field === 'object') binding.sourceObject = { ...binding.sourceObject!, objectRevisionId: id(90) };
    if (field === 'point') result.receipts[1].binding.binding.pointProjectMetres = [9, 9, 9];
    if (field === 'binding-hash') binding.contentSha256 = 'f'.repeat(64);
    if (field === 'impact') Reflect.deleteProperty(child, 'locationImpact'); if (field === 'mandate') Reflect.deleteProperty(child, 'initialFillMandate');
    if (field === 'mandate-impact') child.initialFillMandate!.impactId = id(90);
    if (['model', 'object'].includes(field)) binding.contentSha256 = digest(endpointBindingContentHashInput(binding));
    if (field === 'point') { const changed = result.receipts[1].binding.binding; changed.contentSha256 = digest(endpointBindingContentHashInput(changed)); }
    vi.mocked(fetch).mockResolvedValueOnce(response(result)); await expect(saveCableEndpointPair(project, 'token', cable, command(), actor)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('does not escalate an explicit null policy or null calculation into a writable mandate', async () => {
    const input = command(); for (const entry of input.endpoints) { entry.command.initialFill = null; entry.command.calculation = null; }
    const valid = receipt(input); vi.mocked(fetch).mockResolvedValueOnce(response(valid));
    await expect(saveCableEndpointPair(project, 'token', cable, input, actor)).resolves.toEqual(valid);
    const wrong = receipt(input); wrong.receipts[0].locationImpact.status = 'pending'; vi.mocked(fetch).mockResolvedValueOnce(response(wrong));
    await expect(saveCableEndpointPair(project, 'token', cable, input, actor)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('recovers a saved receipt or permanent closed disposition with the same exact body and a current token', async () => {
    const input = command(), saved = { schemaVersion: 'wfc.pf.cable-endpoint-pair-recovery.v1', status: 'saved', receipt: { ...receipt(input), duplicate: true } }, closure = closed(input);
    vi.mocked(fetch).mockResolvedValueOnce(response(saved)).mockResolvedValueOnce(response(closure));
    await expect(closePendingCableEndpointPair(project, 'new-login', cable, input, actor)).resolves.toEqual(saved);
    await expect(closePendingCableEndpointPair(project, 'new-login', cable, input, actor)).resolves.toEqual(closure);
    for (const [url, options] of vi.mocked(fetch).mock.calls) { expect(url).toContain(`/cable-endpoint-pairs/${cable}/close-pending`); expect(options).toMatchObject({ method: 'POST', body: JSON.stringify(input), headers: { Authorization: 'Bearer new-login' } }); }
  });
  it.each(['actor', 'project', 'cable', 'key', 'hash', 'revision', 'context'] as const)('refuses a foreign closed disposition: %s', async field => {
    const result = closed(), closure = result.closure;
    if (field === 'actor') closure.actorId = id(90); if (field === 'project') closure.projectId = id(90); if (field === 'cable') closure.cableId = id(90);
    if (field === 'key') closure.idempotencyKey = id(90); if (field === 'hash') closure.commandSha256 = 'f'.repeat(64); if (field === 'revision') closure.expectedCableWriteRevision = '900';
    if (field === 'context') closure.expectedContexts = { ...closure.expectedContexts, from: 'f'.repeat(64) };
    vi.mocked(fetch).mockResolvedValueOnce(response(result)); await expect(closePendingCableEndpointPair(project, 'token', cable, command(), actor)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('refuses malformed or non-v3 commands and route identifiers before dispatch', async () => {
    const input = command(), wrong = structuredClone(input); Reflect.deleteProperty(wrong.endpoints[0].command, 'initialFill'); Reflect.set(wrong.endpoints[0].command, 'schemaVersion', 'wfc.pf.cable-endpoint-command.v2');
    for (const [projectId, value, accountId] of [[project, wrong, actor], ['../project', input, actor], [project, input, 'foreign'], [project, { ...input, secret: 'unexpected' }, actor]] as const)
      await expect(saveCableEndpointPair(projectId, 'token', cable, value as CableEndpointPairCommand, accountId)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps auth, generic refusal and network failure outcomes uncertain rather than inventing a closure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new ReadableStream(), { status: 403 }))
      .mockResolvedValueOnce(response({ schemaVersion: 'wfc.pf.cable-endpoint-error.v1', code: 'CABLE_ENDPOINT_CONTEXT_CHANGED', message: 'private server detail', outcome: 'refused' }, 409))
      .mockRejectedValueOnce(new TypeError('connection lost'));
    await expect(saveCableEndpointPair(project, 'token', cable, command(), actor)).rejects.toMatchObject({ code: 'ACCESS_REQUIRED', status: 403, outcome: 'unknown' });
    await expect(saveCableEndpointPair(project, 'token', cable, command(), actor)).rejects.toMatchObject({ code: 'CABLE_ENDPOINT_CONTEXT_CHANGED', outcome: 'refused' });
    await expect(saveCableEndpointPair(project, 'token', cable, command(), actor)).rejects.toThrow('connection lost');
  });
  it('bounds streamed bytes and refuses invalid UTF8 and duplicate JSON keys', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new Uint8Array(2 * 1024 * 1024 + 1))).mockResolvedValueOnce(new Response(new Uint8Array([0xff])))
      .mockResolvedValueOnce(new Response('{"status":"saved","st\\u0061tus":"closed"}'));
    for (let index = 0; index < 3; index++) await expect(saveCableEndpointPair(project, 'token', cable, command(), actor)).rejects.toMatchObject({ code: 'INVALID_RESPONSE', outcome: 'unknown' });
  });
  it('settles stalled fetch and body promises within the deadline and honors caller cancellation', async () => {
    vi.useFakeTimers(); vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => {}));
    const fetchTimeout = expect(saveCableEndpointPair(project, 'token', cable, command(), actor)).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT', outcome: 'unknown' });
    await vi.advanceTimersByTimeAsync(30000); await fetchTimeout;
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new ReadableStream()));
    const bodyTimeout = expect(saveCableEndpointPair(project, 'token', cable, command(), actor)).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(30000); await bodyTimeout;
    const controller = new AbortController(); vi.mocked(fetch).mockImplementationOnce(() => new Promise(() => {}));
    const cancelled = expect(saveCableEndpointPair(project, 'token', cable, command(), actor, controller.signal)).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await cancelled;
  });
});
