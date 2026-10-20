import { describe, expect, it } from 'vitest';
import { cableEndpointCommandHashInput, cableEndpointCommandSchema, cableEndpointContextHashInput, cableEndpointContextSchema,
  cableEndpointImpactSchema, cableEndpointClosedSchema, cableEndpointRecoverySchema, cableEndpointSelectionEvidenceSchema } from './pathfinderCableEndpoints.js';
const id = (n: number) => `f1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const current = { modelVersionId: id(3), selectionRevision: '1', contentFingerprint: 'a'.repeat(64), aggregateId: id(4), artifactId: id(5),
  projectionSha256: 'b'.repeat(64), captureFrameId: id(6), geometryRevision: '2', traceId: id(7) };
const context = () => ({ schemaVersion: 'wfc.pf.cable-endpoint-context.v1', projectId: id(1), cableId: id(2), end: 'from', cableWriteRevision: '7',
  logicalName: 'Equipment', logicalKey: 'EQUIPMENT', mto: 'LV', canBind: true, reasonCodes: [], registryRevision: '3', location: null, head: null, current, contextSha256: 'c'.repeat(64) });
const command = () => ({ schemaVersion: 'wfc.pf.cable-endpoint-command.v1', idempotencyKey: id(8), expectedContextSha256: 'c'.repeat(64), expectedCableWriteRevision: '7',
  expectedLogicalName: 'Equipment', expectedRegistryRevision: '3', expectedLocationId: null, expectedLocationRevision: null, expectedHeadId: null, expectedCurrent: current,
  reason: 'Explicit synthetic selection', selection: { mode: 'fixed-world', pointProjectMetres: [1, 2, 3], derivation: 'manual-world-point', displaySdkObjectId: null } });
const unavailable = () => ({ schemaVersion: 'wfc.pf.cable-endpoint-selection.v1', projectId: id(1), current, sdkObjectId: 12, status: 'unavailable', reasonCodes: ['NOT_RETAINED'],
  object: null, pointProjectMetres: null, bounds: null, approximate: true, derivation: null });
describe('strict cable endpoint command and display contracts', () => {
  it('hashes the strict exact body and context omits only its own hash', () => {
    const c = cableEndpointContextSchema.parse(context()), write = cableEndpointCommandSchema.parse(command());
    const { contextSha256: _hash, ...body } = c; expect(cableEndpointContextHashInput(c)).toEqual(body);
    expect(cableEndpointCommandHashInput(write)).toEqual(write); expect(cableEndpointCommandHashInput(write).idempotencyKey).toBe(id(8));
  });
  it.each([['canBind', true], ['mto', 'MV'], ['current', null], ['logicalName', ' Equipment '], ['logicalKey', 'OTHER']])('refuses contradictory bindable context %s', (field, value) => {
    const c = context(); if (field === 'canBind') Object.assign(c, { logicalName: null, logicalKey: null });
    expect(cableEndpointContextSchema.safeParse({ ...c, [field]: value }).success).toBe(false);
  });
  it('allows missing-name and unavailable-preparation diagnostics without granting binding', () => {
    expect(cableEndpointContextSchema.safeParse({ ...context(), logicalName: null, logicalKey: null, canBind: false, current: null, reasonCodes: ['CABLE_ENDPOINT_NAME_REQUIRED', 'ENDPOINT_PREPARATION_REQUIRED'] }).success).toBe(true);
  });
  it.each([0, -1, 2147483648, 1.1, Infinity])('refuses invalid SDK id %s', sdkObjectId => {
    expect(cableEndpointSelectionEvidenceSchema.safeParse({ ...unavailable(), sdkObjectId }).success).toBe(false);
  });
  it('unavailable selection carries no usable object, point, bounds or derivation', () => {
    expect(cableEndpointSelectionEvidenceSchema.safeParse(unavailable()).success).toBe(true);
    expect(cableEndpointSelectionEvidenceSchema.safeParse({ ...unavailable(), pointProjectMetres: [1, 2, 3] }).success).toBe(false);
    expect(cableEndpointSelectionEvidenceSchema.safeParse({ ...unavailable(), reasonCodes: [] }).success).toBe(false);
    expect(cableEndpointSelectionEvidenceSchema.safeParse({ ...unavailable(), status: 'available' }).success).toBe(false);
  });
  it.each(['actorId', 'location', 'pointProjectMetres', 'modelMatrix'])('rejects extra authority field %s', field => {
    expect(cableEndpointCommandSchema.safeParse({ ...command(), [field]: id(999) }).success).toBe(false);
  });
  it.each(['', ' ', 'bad\u0001reason', '\ud800'])('refuses invalid reason %j', reason => {
    expect(cableEndpointCommandSchema.safeParse({ ...command(), reason }).success).toBe(false);
  });
  it('requires a matching known-location revision and forbids caller object-attached/unqualified point authority', () => {
    expect(cableEndpointCommandSchema.safeParse({ ...command(), expectedLocationId: id(9) }).success).toBe(false);
    expect(cableEndpointCommandSchema.safeParse({ ...command(), expectedHeadId: id(10) }).success).toBe(false);
    expect(cableEndpointCommandSchema.safeParse({ ...command(), selection: { mode: 'object-attached', object: { traceId: id(7), objectRevisionId: id(9), recordSha256: 'a'.repeat(64) } } }).success).toBe(false);
    expect(cableEndpointCommandSchema.safeParse({ ...command(), selection: { mode: 'fixed-world', pointProjectMetres: [NaN, 2, 3], derivation: 'manual-world-point', displaySdkObjectId: null } }).success).toBe(false);
  });
  it('retains exact large decimal CAS revisions instead of passing through floating point', () => {
    const parsed = cableEndpointCommandSchema.parse({ ...command(), expectedCableWriteRevision: '9007199254740993' }); expect(parsed.expectedCableWriteRevision).toBe('9007199254740993');
    expect(cableEndpointCommandSchema.safeParse({ ...command(), expectedCableWriteRevision: 7 }).success).toBe(false);
  });
  it('counts both ends independently while retaining bounded sorted unique affected cable IDs', () => {
    expect(cableEndpointImpactSchema.safeParse({ fromOccurrences: 2, toOccurrences: 2, distinctCables: 2, cableIds: [id(1), id(2)] }).success).toBe(true);
    for (const body of [{ fromOccurrences: 3, toOccurrences: 0, distinctCables: 2, cableIds: [id(1), id(2)] },
      { fromOccurrences: 1, toOccurrences: 0, distinctCables: 2, cableIds: [id(2), id(1)] }, { fromOccurrences: 1, toOccurrences: 0, distinctCables: 2, cableIds: [id(1), id(1)] }]) expect(cableEndpointImpactSchema.safeParse(body).success).toBe(false);
  });
  it('closed proofs bind exact owner and command and do not imply any saved binding or Apply', () => {
    const closure = { schemaVersion: 'wfc.pf.cable-endpoint-closed.v1', projectId: id(1), actorId: id(11), cableId: id(2), end: 'from', idempotencyKey: id(8), commandSha256: 'd'.repeat(64),
      expectedCableWriteRevision: '7', expectedContextSha256: 'c'.repeat(64) };
    expect(cableEndpointClosedSchema.safeParse(closure).success).toBe(true);
    expect(cableEndpointRecoverySchema.safeParse({ schemaVersion: 'wfc.pf.cable-endpoint-recovery.v1', status: 'closed', closure }).success).toBe(true);
    expect(cableEndpointRecoverySchema.safeParse({ schemaVersion: 'wfc.pf.cable-endpoint-recovery.v1', status: 'closed', closure, receipt: {} }).success).toBe(false);
    const { actorId: _actor, ...noActor } = closure; expect(cableEndpointClosedSchema.safeParse(noActor).success).toBe(false);
  });
  it('retained v1 and v2 bodies keep their exact fields without a new initial-fill default', () => {
    const v1 = command(), v2 = { ...v1, schemaVersion: 'wfc.pf.cable-endpoint-command.v2', calculation: null };
    expect(cableEndpointCommandSchema.parse(v1)).toEqual(v1); expect(cableEndpointCommandSchema.parse(v2)).toEqual(v2);
    expect(Object.hasOwn(cableEndpointCommandSchema.parse(v2), 'initialFill')).toBe(false);
  });
  it('v3 requires an explicit nullable policy while a policy cannot silently promote older commands', () => {
    const v2 = { ...command(), schemaVersion: 'wfc.pf.cable-endpoint-command.v2', calculation: null };
    expect(cableEndpointCommandSchema.safeParse({ ...v2, schemaVersion: 'wfc.pf.cable-endpoint-command.v3' }).success).toBe(false);
    expect(cableEndpointCommandSchema.safeParse({ ...v2, initialFill: { mode: 'when-both-empty' } }).success).toBe(false);
    expect(cableEndpointCommandSchema.safeParse({ ...command(), initialFill: null }).success).toBe(false);
  });
  it('only exact explicit v3 when-both-empty policy carries its narrowly specified intent', () => {
    const input = { ...command(), schemaVersion: 'wfc.pf.cable-endpoint-command.v3', calculation: null, initialFill: { mode: 'when-both-empty' } };
    expect(cableEndpointCommandSchema.parse(input)).toEqual(input);
    expect(cableEndpointCommandSchema.safeParse({ ...input, initialFill: { mode: 'always' } }).success).toBe(false);
    expect(cableEndpointCommandSchema.safeParse({ ...input, initialFill: { mode: 'when-both-empty', actorId: id(99) } }).success).toBe(false);
  });
});
