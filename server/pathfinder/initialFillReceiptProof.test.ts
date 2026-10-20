// @vitest-environment node
import type { PoolClient } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cableEndpointCommandSchema, cableEndpointReceiptSchema } from '../../shared/pathfinderCableEndpoints.js';
import { initialFillMandateContentHashInput, initialFillMandateRecordSchema, initialFillMandateReference, initialFillProvenanceSchema,
  initialFillRequestHashInput } from '../../shared/pathfinderInitialFill.js';
import { locationImpactItemSchema, locationImpactRecordSchema } from '../../shared/pathfinderLocationImpacts.js';
import { revisionResultEnvelopeSchema } from '../../shared/pathfinderRevisionResults.js';
import { createInitialFillReceiptProofReader, initialFillOwnWriteTransition, readInitialFillReceiptProof, INITIAL_FILL_PROOF_READ_BYTES, type InitialFillReceiptProofInput } from './initialFillReceiptProof.js';
import { endpointBindingFixture, endpointFixtureId as id } from './endpointBindingFixtures.js';
import { endpointBindingHash as digest, readCurrentEndpointBindingContext } from './endpointBindingRepository.js';
import { defaultOptions, type ScopedDependencySnapshot, type EngineResponse } from './jobContracts.js';
import { syntheticEngineIdentity } from './calculationFixtures.js';
import { hash } from './dependencies.js';
import { initialFillIdempotencyKey } from './initialFillIdentity.js';
import type { EndpointCalculationPoint } from './endpointCalculationProvenance.js';
import { PathFinderError } from './errors.js';

type Row = Record<string, any>;
const now = Date.parse('2026-10-20T12:00:00.000Z');
const signed = <T extends { contentSha256: string }>(value: T): T => {
  const { contentSha256: _hash, ...body } = value; return { ...value, contentSha256: digest(body) };
};
async function fixture() {
  const f = endpointBindingFixture(), originalBinding = f.command(), projectId = f.f.aggregate.projectId, cableId = id(10), proposalId = id(200), jobId = id(201);
  const binding = await f.repo.confirm(projectId, f.who, f.locationId, originalBinding), current = (await readCurrentEndpointBindingContext(f.client as never, projectId))!;
  const command = cableEndpointCommandSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-command.v3', idempotencyKey: id(202),
    expectedContextSha256: 'e'.repeat(64), expectedCableWriteRevision: '7', expectedLogicalName: 'EQUIPMENT', expectedRegistryRevision: '4',
    expectedLocationId: null, expectedLocationRevision: null, expectedHeadId: null, expectedCurrent: current,
    reason: 'Synthetic explicit conditional initial fill.', selection: { mode: 'fixed-world', pointProjectMetres: [2, 3, 4], derivation: 'manual-world-point', displaySdkObjectId: null },
    calculation: { preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, timeoutMilliseconds: 60000 }, initialFill: { mode: 'when-both-empty' } });
  const impact = signed(locationImpactRecordSchema.parse({ schemaVersion: 'wfc.pf.location-impact-record.v1', id: id(203), projectId,
    actorId: f.who.userId, actorAdminRevision: '9', loginId: f.who.loginId, loginExpiresAt: new Date(f.who.loginExpiresAt).toISOString(),
    authorityExpiresAt: new Date(f.who.loginExpiresAt).toISOString(), installationEpoch: id(204), idempotencyKey: command.idempotencyKey,
    commandSha256: digest(command), locationId: binding.locationId, bindingId: binding.binding.id, bindingContentSha256: binding.binding.contentSha256,
    observedRegistryRevision: binding.registryRevision, current, calculation: command.schemaVersion === 'wfc.pf.cable-endpoint-command.v3' ? command.calculation : null,
    eligibleCableIds: [cableId], excludedMvCableIds: [], blockedCategoryCableIds: [], createdAt: new Date(now).toISOString(), contentSha256: '0'.repeat(64) }));
  const mandateDraft = initialFillMandateRecordSchema.parse({ schemaVersion: 'wfc.pf.initial-fill-mandate.v1', id: id(205), projectId,
    impactId: impact.id, impactContentSha256: impact.contentSha256, commandSha256: impact.commandSha256, idempotencyKey: impact.idempotencyKey,
    mode: 'when-both-empty', actorId: impact.actorId, actorAdminRevision: impact.actorAdminRevision, loginId: impact.loginId,
    loginExpiresAt: impact.loginExpiresAt, authorityExpiresAt: impact.authorityExpiresAt, installationEpoch: impact.installationEpoch,
    current, eligibleCableIds: [cableId], createdAt: new Date(now).toISOString(), contentSha256: '0'.repeat(64) });
  const mandate = { ...mandateDraft, contentSha256: digest(initialFillMandateContentHashInput(mandateDraft)) };
  const endpoint = (locationId: string): EndpointCalculationPoint => ({ locationId, locationRevision: '1', bindingRevision: '1', point: [2, 3, 4],
    bindingId: binding.binding.id, bindingContentSha256: binding.binding.contentSha256, mode: 'fixed-world', captureFrameId: current.captureFrameId,
    qualifiedProjectFrameId: null, aggregateId: current.aggregateId, projectionSha256: current.projectionSha256, sourceObjectRevisionId: null, migrationDecisionId: null });
  const dependencies: ScopedDependencySnapshot = { schemaVersion: 'pathfinder.dependencies.v7', projectId, cableId, cableWriteRevision: '7',
    model: { id: current.modelVersionId, selectionRevision: current.selectionRevision, contentFingerprint: current.contentFingerprint },
    artifact: { id: current.artifactId, sha256: current.projectionSha256 }, preparation: { aggregateId: current.aggregateId,
      geometryRevision: current.geometryRevision, captureFrameId: current.captureFrameId, projectionSha256: current.projectionSha256 },
    routing: { catalogRevision: '2', routingContentSha256: 'a'.repeat(64), routingPolicyRevision: '3', routingPolicySha256: 'b'.repeat(64) },
    cableInputs: { fromLocation: 'EQUIPMENT', toLocation: 'TO', mto: 'LV', cableTypeId: id(206) },
    settings: { revision: '2', connectionGap: '1', secondaryTrayLength: null, endConnectionLength: '1', additionalBendingPercent: '10' },
    options: { ...defaultOptions, secondaryDistanceMeters: 2, preferVerticalApproach: true }, from: endpoint(binding.locationId), to: endpoint(id(207)),
    endpointResolution: { schemaVersion: 'pathfinder.endpoint-resolution.v1', matchingPolicy: 'nfc-trim-uppercase-v1',
      from: { logicalKey: 'EQUIPMENT', locationId: binding.locationId }, to: { logicalKey: 'TO', locationId: id(207) } },
    comparison: null, engineVersion: 'pathfinder-45c24bf5-pf1-modelrunner-v1', engineIdentity: syntheticEngineIdentity() };
  const ledger = { schemaVersion: 'wfc.pf.length-components.v1' as const, formulaVersion: 'pathfinder-45c24bf5' as const, settingsRevision: '2',
    raw: { lengthMeters: 5, fromDistanceMeters: 1, toDistanceMeters: 1 }, rawLengthDecimalMeters: '5',
    from: { requiresSecondary: false, removedApproachMeters: '0' }, to: { requiresSecondary: false, removedApproachMeters: '0' },
    settings: { secondaryTrayLengthMeters: null, endConnectionLengthMeters: '1', additionalBendingPercent: '10' }, secondaryEnds: 0,
    replacementMeters: '0', beforeClampMeters: '5', clampAdjustmentMeters: '0', afterClampMeters: '5', beforePercentageMeters: '6', bendingIncrementMeters: '0.6',
    unroundedMeters: '6.6', ceilingIncrementMeters: '0.4', designLengthMeters: '7', gapAccounting: 'already-in-raw-geometry' as const };
  const result: EngineResponse = { schemaVersion: 'pathfinder.model.response.v1', requestId: id(208), status: 'calculated', message: 'Synthetic receipt proof only.',
    engineeringAccepted: false, route: { success: true, message: '', routeText: '/A/SECONDARY', routeCodes: ['A', 'SECONDARY'], segmentIds: ['dbid:1'],
      pathPoints: [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }], lengthMeters: 5, fromDistanceMeters: 1, toDistanceMeters: 1,
      fromRequiresSecondary: false, toRequiresSecondary: false, connectionGapCount: 0, connectionGapLengthMeters: 0 },
    design: { lengthBeforePercentageMeters: '6', unroundedLengthMeters: '6.6', designLengthMeters: '7' }, lengthLedger: ledger };
  const baselineHash = 'c'.repeat(64), proposalHash = hash({ dependencies, result, baselineHash });
  const seal = revisionResultEnvelopeSchema.parse({ schemaVersion: 'wfc.pf.cable-revision-result.v1', id: id(209), projectId, admissionId: id(210),
    jobId, cableId, proposalId, proposalHash, baselineHash, dependencyHash: hash(dependencies), engineResultSha256: hash(result), ledgerHash: hash(ledger),
    oldModel: null, summary: { calculationMode: 'calculate', newModel: dependencies.model, routeText: result.route!.routeText,
      rawLengthMeters: 5, designLengthMeters: '7', unroundedMeters: '6.6', delta: { rawLengthMeters: null, designLengthMeters: null, unroundedMeters: null, baseline: 'unavailable' }, reasonCodes: [] },
    comparisonRef: null, observedEvents: [], lengthLedger: ledger, physicalChangeProven: false, createdAt: new Date(now).toISOString(), revisionResultSha256: 'd'.repeat(64) });
  const item = signed(locationImpactItemSchema.parse({ schemaVersion: 'wfc.pf.location-impact-item.v1', projectId, impactId: impact.id, cableId,
    generation: '2', cableWriteRevision: '7', fromLogicalKey: 'EQUIPMENT', toLogicalKey: 'TO', category: 'LV', eligible: true, contentSha256: '0'.repeat(64) }));
  const key = initialFillIdempotencyKey({ projectId, cableId, proposalId, proposalHash, mandateId: mandate.id, expectedCableWriteRevision: '7' });
  const request = { schemaVersion: 'wfc.pf.initial-fill-request.v1' as const, idempotencyKey: key, proposalId, expectedProposalHash: proposalHash, mandateId: mandate.id, expectedCableWriteRevision: '7' };
  const provenance = initialFillProvenanceSchema.parse({ schemaVersion: 'pathfinder.initial-fill.v1', validationMethod: 'automatic-initial-fill', nativeParity: 'not-performed',
    engineeringAccepted: false, proposalId, proposalHash, dependencies, mandate: initialFillMandateReference(mandate), request,
    revisionResult: { admissionId: seal.admissionId, revisionResultSha256: seal.revisionResultSha256, baselineHash, engineResultSha256: seal.engineResultSha256, ledgerHash: seal.ledgerHash, dependencyHash: seal.dependencyHash },
    authorized: { actorId: mandate.actorId, loginId: mandate.loginId, installationEpoch: mandate.installationEpoch, targetGeneration: item.generation, authorizedAt: new Date(now + 1000).toISOString() } });
  const before = { id: cableId, project_id: projectId, mto: 'LV', from_location: 'EQUIPMENT', to_location: 'TO', cable_type_id: id(206), routing: ' \t\n\u00a0',
    design_length: null, install_length: '3.1250', cable_write_revision: '7', revision: 'engineering-1', tag: 'Cable', updated_at: new Date(now).toISOString() };
  const after = { ...before, routing: result.route!.routeText, design_length: '7.0000', cable_write_revision: '8', updated_at: new Date(now + 1000).toISOString() };
  const saved = cableEndpointReceiptSchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-receipt.v1', projectId, actorId: f.who.userId, cableId, end: 'from', logicalName: 'EQUIPMENT',
    idempotencyKey: command.idempotencyKey, commandSha256: digest(command), expectedCableWriteRevision: '7', expectedContextSha256: command.expectedContextSha256,
    locationId: binding.locationId, binding, impact: { fromOccurrences: 1, toOccurrences: 0, distinctCables: 1, cableIds: [cableId] },
    locationImpact: { id: impact.id, status: 'pending', eligibleCables: 1, excludedMvCables: 0, blockedCategoryCables: 0 }, initialFillMandate: initialFillMandateReference(mandate), duplicate: false });
  const owner = { schemaVersion: 'wfc.pf.cable-endpoint-command-owner.v1', cableId, end: 'from', command };
  const rows = {
    mandate: { project_id: projectId, id: mandate.id, impact_id: impact.id, actor_id: mandate.actorId, login_id: mandate.loginId,
      idempotency_key: mandate.idempotencyKey, command_sha256: mandate.commandSha256, record_sha256: mandate.contentSha256, record: mandate } as Row,
    impact: { project_id: projectId, id: impact.id, actor_id: impact.actorId, login_id: impact.loginId, idempotency_key: impact.idempotencyKey,
      command_sha256: impact.commandSha256, record_sha256: impact.contentSha256, record: impact } as Row,
    command: { kind: 'confirm', request_sha256: digest(owner), request: owner, receipt: { schemaVersion: 'wfc.pf.cable-endpoint-stored.v1', status: 'saved', receipt: saved } } as Row,
    item: { project_id: projectId, impact_id: impact.id, cable_id: cableId, generation: item.generation, eligible: true, record_sha256: item.contentSha256, record: item,
      job_id: jobId, admission_id: seal.admissionId, admission_kind: 'location-impact', input_sha256: 'f'.repeat(64), admission_input_sha256: 'f'.repeat(64),
      requested_by: mandate.actorId, login_id: mandate.loginId, login_expires_at: mandate.loginExpiresAt, authority_kind: 'current-login' } as Row,
  };
  const missing = new Set<string>();
  const query = vi.fn(async (sql: string) => {
    const kind = sql.includes('FROM pf_initial_fill_mandates') ? 'mandate' : sql.includes('historical-impact') ? 'impact' : sql.includes('historical-command') ? 'command' : sql.includes('historical-member') ? 'item' : null;
    if (!kind) throw Error('Unexpected historical SQL query.'); return { rows: missing.has(kind) ? [] : [rows[kind]] };
  });
  const client = { query } as unknown as PoolClient;
  const input: InitialFillReceiptProofInput = { projectId, cableId, receiptId: id(211), proposalId, actorId: f.who.userId, idempotencyKey: key,
    payloadHash: hash(initialFillRequestHashInput(request)), before, after, provenance, dependencies, result, seal };
  return { input, before, after, provenance, dependencies, result, seal, mandate, impact, item, command, owner, saved, rows, missing, query, client,
    run: () => readInitialFillReceiptProof(client, input) };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); });

describe('historical conditional initial-fill receipt chain with synthetic SQL and a caller-verified seal', () => {
  it('proves the distinct exact own write without a fake human review or a still-live original login', async () => {
    const f = await fixture(); vi.setSystemTime(now + 86400000); expect(await f.run()).toBe(true);
    expect(f.query).toHaveBeenCalledTimes(4);
    const sql = f.query.mock.calls.map(([sql]) => sql).join('\n');
    expect(sql).not.toMatch(/pf_reviews|FROM users|viewer_login_bindings|pf_installation_state|pf_location_impact_targets|INSERT|UPDATE|DELETE/);
    expect(sql).toContain('octet_length(record::text)<=1048576'); expect(sql).toContain('octet_length(i.record::text)<=32768');
    expect(sql).toContain('e.job_id=$4 LIMIT 1');
  });
  it('keeps immutable common caches local to one reader without caching item generation or crossing requests', async () => {
    const f = await fixture(), reader = createInitialFillReceiptProofReader(f.client); expect(await reader(f.input)).toBe(true); expect(await reader(f.input)).toBe(true);
    expect(f.query).toHaveBeenCalledTimes(5); expect(f.query.mock.calls.filter(([sql]) => sql.includes('historical-member'))).toHaveLength(2);
    expect(await readInitialFillReceiptProof(f.client, f.input)).toBe(true); expect(f.query).toHaveBeenCalledTimes(9);
  });
  it.each(['mandate', 'impact', 'command', 'item'])('refuses missing retained %s evidence', async key => {
    const f = await fixture(); f.missing.add(key); expect(await f.run()).toBe(false);
  });
  it.each(['mandate', 'impact', 'item'])('rejects changed %s content under the original stored hash', async key => {
    const f = await fixture(); f.rows[key as 'mandate' | 'impact' | 'item'].record.contentSha256 = 'f'.repeat(64); expect(await f.run()).toBe(false);
  });
  it.each(['owner-hash', 'legacy-v2', 'closed', 'no-mandate-ref', 'wrong-saved-actor', 'wrong-saved-binding', 'wrong-logical-name'] as const)(
    'never reinterprets a nonauthorized original command: %s', async kind => {
      const f = await fixture(); if (kind === 'owner-hash') f.rows.command.request_sha256 = 'f'.repeat(64);
      if (kind === 'legacy-v2') { const legacy = { ...f.command, schemaVersion: 'wfc.pf.cable-endpoint-command.v2' }; delete (legacy as Row).initialFill; f.owner.command = legacy as never; f.rows.command.request_sha256 = digest(f.owner); }
      if (kind === 'closed') f.rows.command.receipt.status = 'closed'; if (kind === 'no-mandate-ref') delete f.saved.initialFillMandate;
      if (kind === 'wrong-saved-actor') f.saved.actorId = id(999); if (kind === 'wrong-saved-binding') f.saved.binding.binding.contentSha256 = 'f'.repeat(64);
      if (kind === 'wrong-logical-name') f.saved.logicalName = 'OTHER'; expect(await f.run()).toBe(false);
    });
  it.each(['actorId', 'loginId', 'installationEpoch', 'targetGeneration'] as const)('requires recorded authorized %s to match its original immutable scope', async field => {
    const f = await fixture(); f.provenance.authorized[field] = field === 'targetGeneration' ? '3' : id(999); expect(await f.run()).toBe(false);
  });
  it.each(['before-mandate', 'at-expiry'] as const)('rejects an authorization time %s without relying on current clock', async kind => {
    const f = await fixture(); f.provenance.authorized.authorizedAt = kind === 'before-mandate' ? new Date(now - 1).toISOString() : f.mandate.authorityExpiresAt;
    expect(await f.run()).toBe(false);
  });
  it.each(['item-generation', 'item-revision', 'item-logical-key', 'item-category', 'foreign-job'] as const)('requires exact historical member linkage: %s', async kind => {
    const f = await fixture(); if (kind === 'item-generation') f.provenance.authorized.targetGeneration = '3';
    if (kind === 'item-revision') f.item.cableWriteRevision = '6'; if (kind === 'item-logical-key') f.item.fromLogicalKey = 'OTHER';
    if (kind === 'item-category') f.item.category = 'Control'; if (kind === 'foreign-job') f.rows.item.job_id = id(999);
    if (kind !== 'foreign-job') { f.item.contentSha256 = signed(f.item).contentSha256; f.rows.item.record_sha256 = f.item.contentSha256; }
    expect(await f.run()).toBe(false);
  });
  it.each(['admission_id', 'admission_kind', 'admission_input_sha256', 'requested_by', 'login_id', 'login_expires_at', 'authority_kind'])(
    'requires the original immutable admission/job identity: %s', async field => {
      const f = await fixture(); f.rows.item[field] = field.endsWith('sha256') ? 'a'.repeat(64) : field === 'login_expires_at' ? new Date(now + 99999).toISOString() : id(999);
      expect(await f.run()).toBe(false);
    });
  it.each(['payload', 'key', 'proposal', 'revision-result', 'ledger', 'dependency', 'output-route', 'before-input'] as const)('refuses exchanged or changed %s proof', async kind => {
    const f = await fixture(); if (kind === 'payload') f.input.payloadHash = 'f'.repeat(64); if (kind === 'key') f.input.idempotencyKey = id(999);
    if (kind === 'proposal') f.input.proposalId = id(999); if (kind === 'revision-result') f.provenance.revisionResult.revisionResultSha256 = 'f'.repeat(64);
    if (kind === 'ledger') f.result.lengthLedger!.designLengthMeters = '8'; if (kind === 'dependency') f.dependencies.settings.revision = '3';
    if (kind === 'output-route') f.after.routing = '/OTHER'; if (kind === 'before-input') f.before.from_location = 'OTHER'; expect(await f.run()).toBe(false);
  });
  it('does not swallow a reader deadline or terminal budget refusal inside its fail-closed catch', async () => {
    const f = await fixture(); let stopped = false; const original = f.query.getMockImplementation()!;
    f.query.mockImplementation(async sql => { const value = await original(sql); stopped = true; return value; });
    const reader = createInitialFillReceiptProofReader(f.client, () => { if (stopped) throw Error('Terminal read deadline.'); });
    await expect(reader(f.input)).rejects.toThrow('Terminal read deadline.');
  });
  it('latches the32MiB retained-proof budget and refuses subsequent SQL in that reader', async () => {
    const f = await fixture(); f.query.mockResolvedValue({ rows: [{ padding: 'x'.repeat(INITIAL_FILL_PROOF_READ_BYTES + 1) }] });
    const reader = createInitialFillReceiptProofReader(f.client);
    await expect(reader(f.input)).rejects.toMatchObject({ code: 'INITIAL_FILL_PROOF_READ_LIMIT', status: 413 });
    await expect(reader(f.input)).rejects.toMatchObject({ code: 'INITIAL_FILL_PROOF_READ_LIMIT' }); expect(f.query).toHaveBeenCalledOnce();
  });
  it.each(['WORKFLOW_READ_LIMIT', 'WORKFLOW_DEADLINE_EXCEEDED', 'RECALCULATION_COLLECTION_DEADLINE'])('propagates outer %s instead of turning it into missing historical proof', async code => {
    const f = await fixture(), error = new PathFinderError(code, 503); f.query.mockRejectedValue(error);
    await expect(f.run()).rejects.toBe(error);
  });
});

describe('initial-fill exact pair transition', () => {
  it('accepts all approved whitespace, exact numeric SQL scale and a revision beyond Number precision', async () => {
    const f = await fixture(); f.before.routing = '\t\n\u00a0\ufeff'; f.before.cable_write_revision = '9007199254740993'; f.after.cable_write_revision = '9007199254740994';
    expect(initialFillOwnWriteTransition(f.input)).toBe(true);
  });
  it.each(['existing-route', 'zero', 'existing-length', 'missing-length', 'extra-field', 'install', 'business-field', 'non-unit-revision', 'invalid-output'] as const)(
    'refuses %s as a conditional pair transition', async kind => {
      const f = await fixture(); if (kind === 'existing-route') f.before.routing = '/OLD'; if (kind === 'zero') (f.before as Row).design_length = '0';
      if (kind === 'existing-length') (f.before as Row).design_length = '4'; if (kind === 'missing-length') delete (f.before as Row).design_length;
      if (kind === 'extra-field') (f.after as Row).added = true; if (kind === 'install') f.after.install_length = '9'; if (kind === 'business-field') f.after.revision = 'other';
      if (kind === 'non-unit-revision') f.after.cable_write_revision = '9'; if (kind === 'invalid-output') f.after.design_length = '7.5';
      expect(initialFillOwnWriteTransition(f.input)).toBe(false);
    });
});
