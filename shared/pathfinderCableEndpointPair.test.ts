// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cableEndpointCommandSchema } from './pathfinderCableEndpoints.js';
import { cableEndpointPairCommandSchema, cableEndpointPairCommandHashInput, cableEndpointPairClosedSchema, cableEndpointPairRecoverySchema } from './pathfinderCableEndpointPair.js';
const id = (n: number) => `f2600000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = (n: number) => String(n).repeat(64);
function fixture() {
  const current = { modelVersionId: id(1), selectionRevision: '2', contentFingerprint: hash(1), aggregateId: id(2), artifactId: id(3),
    projectionSha256: hash(2), captureFrameId: id(4), geometryRevision: '5', traceId: id(5) };
  const common = { schemaVersion: 'wfc.pf.cable-endpoint-command.v3' as const, expectedCableWriteRevision: '7', expectedRegistryRevision: '9',
    expectedLocationId: null, expectedLocationRevision: null, expectedHeadId: null, expectedCurrent: current, reason: 'Explicit synthetic pair confirmation',
    selection: { mode: 'object-derived' as const, sdkObjectId: 123, object: { traceId: id(5), objectRevisionId: id(6), recordSha256: hash(3) } },
    calculation: { preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, timeoutMilliseconds: 60000 },
    initialFill: { mode: 'when-both-empty' as const } };
  return { schemaVersion: 'wfc.pf.cable-endpoint-pair-command.v1' as const, idempotencyKey: id(10), expectedContexts: { from: hash(4), to: hash(5) },
    endpoints: [{ end: 'from' as const, command: { ...common, idempotencyKey: id(11), expectedContextSha256: hash(4), expectedLogicalName: 'Shared A' } },
      { end: 'to' as const, command: { ...structuredClone(common), idempotencyKey: id(12), expectedContextSha256: hash(5), expectedLogicalName: 'Shared B' } }] };
}
describe('versioned atomic cable endpoint pair contracts', () => {
  it('retains the exact explicit body and original two contexts without defaults or transforms', () => {
    const value = fixture(); expect(cableEndpointPairCommandSchema.parse(value)).toEqual(value); expect(cableEndpointPairCommandHashInput(value)).toEqual(value);
    value.endpoints.pop(); expect(cableEndpointPairCommandSchema.parse(value).expectedContexts.to).toBe(hash(5));
  });
  it.each(['v1', 'v2'])('does not silently turn a pending legacy %s command into pair authority', version => {
    const value = fixture(), command = value.endpoints[0].command as unknown as Record<string, unknown>;
    command.schemaVersion = `wfc.pf.cable-endpoint-command.${version}`; delete command.initialFill; if (version === 'v1') delete command.calculation;
    expect(cableEndpointCommandSchema.parse(command)).toEqual(command); expect(cableEndpointPairCommandSchema.safeParse(value).success).toBe(false);
  });
  it.each(['outer-key', 'child-key', 'reverse', 'same-end', 'context', 'cable', 'registry', 'model', 'preferences', 'policy', 'missing-context', 'authority'])(
    'refuses inconsistent %s before any server side effect', kind => {
      const value = fixture();
      if (kind === 'outer-key') value.idempotencyKey = value.endpoints[0].command.idempotencyKey;
      if (kind === 'child-key') value.endpoints[1].command.idempotencyKey = value.endpoints[0].command.idempotencyKey;
      if (kind === 'reverse') value.endpoints.reverse();
      if (kind === 'same-end') Object.assign(value.endpoints[1], { end: 'from' });
      if (kind === 'context') value.expectedContexts.to = hash(6);
      if (kind === 'cable') value.endpoints[1].command.expectedCableWriteRevision = '8';
      if (kind === 'registry') value.endpoints[1].command.expectedRegistryRevision = '10';
      if (kind === 'model') value.endpoints[1].command.expectedCurrent.selectionRevision = '3';
      if (kind === 'preferences') value.endpoints[1].command.calculation.preferences.preferVerticalApproach = false;
      if (kind === 'policy') Object.assign(value.endpoints[1].command, { initialFill: null });
      if (kind === 'missing-context') delete (value.expectedContexts as Partial<typeof value.expectedContexts>).to;
      if (kind === 'authority') Object.assign(value, { actorId: id(99) });
      expect(cableEndpointPairCommandSchema.safeParse(value).success).toBe(false);
    });
  it.each([0, 3])('bounds changed endpoints to one or two, refusing %s', count => {
    const value = fixture(); value.endpoints = Array.from({ length: count }, () => structuredClone(value.endpoints[0])); expect(cableEndpointPairCommandSchema.safeParse(value).success).toBe(false);
  });
  it('retains a matching immutable close disposition and rejects extra claims of a completed save', () => {
    const closure = { schemaVersion: 'wfc.pf.cable-endpoint-pair-closed.v1', projectId: id(20), actorId: id(21), cableId: id(22), idempotencyKey: id(10),
      commandSha256: hash(7), expectedCableWriteRevision: '7', expectedContexts: { from: hash(4), to: hash(5) } };
    expect(cableEndpointPairClosedSchema.parse(closure)).toEqual(closure);
    expect(cableEndpointPairRecoverySchema.parse({ schemaVersion: 'wfc.pf.cable-endpoint-pair-recovery.v1', status: 'closed', closure }).status).toBe('closed');
    expect(cableEndpointPairClosedSchema.safeParse({ ...closure, saved: false }).success).toBe(false);
  });
});
