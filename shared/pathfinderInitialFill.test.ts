import { describe, expect, it } from 'vitest';
import { INITIAL_FILL_ROUTING_WHITESPACE, initialFillApplyRequestSchema, initialFillMandateRecordSchema, initialFillPolicySchema,
  initialFillProvenanceSchema, initialFillProvenanceV1Schema, initialFillProvenanceV2Schema, initialFillRequestHashInput } from './pathfinderInitialFill.js';
const id = (n: number) => `f4000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const request = () => ({ schemaVersion: 'wfc.pf.initial-fill-request.v1', idempotencyKey: id(1), proposalId: id(2), expectedProposalHash: 'a'.repeat(64), mandateId: id(3), expectedCableWriteRevision: '9007199254740993' });
const mandate = () => ({ schemaVersion: 'wfc.pf.initial-fill-mandate.v1', id: id(3), projectId: id(4), impactId: id(5), impactContentSha256: 'b'.repeat(64), commandSha256: 'c'.repeat(64), idempotencyKey: id(6), mode: 'when-both-empty',
  actorId: id(7), actorAdminRevision: '0', loginId: id(8), loginExpiresAt: '2026-10-21T00:00:00.000Z', authorityExpiresAt: '2026-10-20T23:30:00.000Z', installationEpoch: id(9),
  current: { modelVersionId: id(10), selectionRevision: '1', contentFingerprint: 'd'.repeat(64), aggregateId: id(11), artifactId: id(12), projectionSha256: 'e'.repeat(64), captureFrameId: id(13), geometryRevision: '2', traceId: id(14) },
  eligibleCableIds: [id(15)], createdAt: '2026-10-20T23:00:00.000Z', contentSha256: 'f'.repeat(64) });
function protectedProvenance() {
  return { schemaVersion: 'pathfinder.initial-fill.v2', validationMethod: 'automatic-initial-fill', nativeParity: 'not-performed', engineeringAccepted: false,
    proposalId: id(2), proposalHash: 'a'.repeat(64), dependencies: { schemaVersion: 'pathfinder.dependencies.v8', projectId: id(4), cableId: id(15) },
    mandate: { id: id(3), contentSha256: 'f'.repeat(64), impactId: id(5), mode: 'when-both-empty' }, request: request(),
    revisionResult: { admissionId: id(20), revisionResultSha256: 'a'.repeat(64), baselineHash: 'b'.repeat(64), engineResultSha256: 'c'.repeat(64), ledgerHash: 'd'.repeat(64), dependencyHash: 'e'.repeat(64) },
    authorized: { actorId: id(7), loginId: id(8), installationEpoch: id(9), targetGeneration: '1', authorizedAt: '2026-10-20T23:00:01.000Z' },
    barrierEvidence: { schemaVersion: 'wfc.pf.barrier-write-evidence.v1', dependencyVersion: 'pathfinder.dependencies.v8', responseVersion: 'pathfinder.model.response.v3',
      projectId: id(4), cableId: id(15), dependencySha256: 'e'.repeat(64), engineIdentitySha256: 'a'.repeat(64), engineResultSha256: 'c'.repeat(64), contextSha256: 'a'.repeat(64),
      executionSha256: 'b'.repeat(64), routeSha256: 'c'.repeat(64), policySha256: 'd'.repeat(64), profileSha256: 'e'.repeat(64), registryRevision: '3',
      snapshotId: id(30), snapshotSha256: 'f'.repeat(64), drillThroughWalls: false, status: 'no-barriers-declared' } };
}
describe('separate explicit initial-fill contracts', () => {
  it('requires the exact when-both-empty policy and no caller authority fields', () => {
    expect(initialFillPolicySchema.safeParse({ mode: 'when-both-empty' }).success).toBe(true);
    for (const value of [{}, { mode: 'always' }, { mode: 'when-both-empty', actorId: id(7) }]) expect(initialFillPolicySchema.safeParse(value).success).toBe(false);
  });
  it('hash input preserves the entire strict request including key/revision instead of a floating-point coercion', () => { const parsed = initialFillApplyRequestSchema.parse(request()); expect(initialFillRequestHashInput(parsed)).toEqual(request()); expect(parsed.expectedCableWriteRevision).toBe('9007199254740993'); });
  it.each(['reviewId', 'actorId', 'route', 'grantId'])('refuses extra request authority %s', field => expect(initialFillApplyRequestSchema.safeParse({ ...request(), [field]: id(99) }).success).toBe(false));
  it('mandate scope is sorted unique and cannot outlive original finite login authority', () => {
    expect(initialFillMandateRecordSchema.safeParse(mandate()).success).toBe(true);
    expect(initialFillMandateRecordSchema.safeParse({ ...mandate(), eligibleCableIds: [id(15), id(15)] }).success).toBe(false);
    expect(initialFillMandateRecordSchema.safeParse({ ...mandate(), authorityExpiresAt: '2026-10-21T00:00:00.000Z' }).success).toBe(false);
  });
  it('SQL whitespace constant exactly follows JavaScript trim including tabs/NBSP/BOM while keeping zero-width non-whitespace', () => {
    expect([...INITIAL_FILL_ROUTING_WHITESPACE].every(character => character.trim() === '')).toBe(true); expect(INITIAL_FILL_ROUTING_WHITESPACE.trim()).toBe('');
    for (const character of ['\t', '\n', '\u00a0', '\ufeff', '\u3000']) expect(INITIAL_FILL_ROUTING_WHITESPACE).toContain(character);
    expect(INITIAL_FILL_ROUTING_WHITESPACE).not.toContain('\u200b'); expect('\u200b'.trim()).not.toBe(''); expect(INITIAL_FILL_ROUTING_WHITESPACE).not.toContain('0');
  });
  it('automatic provenance carries no fake human review and binds exact mandate/request/seal', () => {
    const provenance = { schemaVersion: 'pathfinder.initial-fill.v1', validationMethod: 'automatic-initial-fill', nativeParity: 'not-performed', engineeringAccepted: false,
      proposalId: id(2), proposalHash: 'a'.repeat(64), dependencies: { schemaVersion: 'pathfinder.dependencies.v7' },
      mandate: { id: id(3), contentSha256: 'f'.repeat(64), impactId: id(5), mode: 'when-both-empty' }, request: request(),
      revisionResult: { admissionId: id(20), revisionResultSha256: 'a'.repeat(64), baselineHash: 'b'.repeat(64), engineResultSha256: 'c'.repeat(64), ledgerHash: 'd'.repeat(64), dependencyHash: 'e'.repeat(64) },
      authorized: { actorId: id(7), loginId: id(8), installationEpoch: id(9), targetGeneration: '1', authorizedAt: '2026-10-20T23:00:01.000Z' } };
    expect(initialFillProvenanceSchema.safeParse(provenance).success).toBe(true);
    expect(initialFillProvenanceV1Schema.parse(provenance)).toEqual(provenance);
    for (const changed of [{ ...provenance, reviewId: id(30) }, { ...provenance, engineeringAccepted: true }, { ...provenance, dependencies: undefined },
      { ...provenance, request: { ...request(), mandateId: id(99) } }]) expect(initialFillProvenanceSchema.safeParse(changed).success).toBe(false);
  });
  it('adds a distinct strict protected version without retrofitting old receipt bodies', () => {
    const value = protectedProvenance();
    expect(initialFillProvenanceV2Schema.parse(value)).toEqual(value); expect(initialFillProvenanceSchema.parse(value)).toEqual(value);
    expect(initialFillProvenanceV1Schema.safeParse(value).success).toBe(false);
    expect(initialFillProvenanceSchema.safeParse({ ...value, schemaVersion: 'pathfinder.initial-fill.v1' }).success).toBe(false);
  });
  it.each(['dependency-version', 'project', 'cable', 'result-hash', 'dependency-hash', 'no-evidence', 'legacy-result', 'unchecked-bypass', 'extra-authority'] as const)(
    'refuses crossed or unqualified protected provenance: %s', kind => {
      const value = protectedProvenance();
      if (kind === 'dependency-version') value.dependencies.schemaVersion = 'pathfinder.dependencies.v7';
      if (kind === 'project') value.barrierEvidence.projectId = id(99);
      if (kind === 'cable') value.barrierEvidence.cableId = id(99);
      if (kind === 'result-hash') value.barrierEvidence.engineResultSha256 = 'f'.repeat(64);
      if (kind === 'dependency-hash') value.barrierEvidence.dependencySha256 = 'f'.repeat(64);
      if (kind === 'no-evidence') delete (value as { barrierEvidence?: unknown }).barrierEvidence;
      if (kind === 'legacy-result') value.barrierEvidence.responseVersion = 'pathfinder.model.response.v1';
      if (kind === 'unchecked-bypass') value.barrierEvidence.status = 'bypassed';
      if (kind === 'extra-authority') Object.assign(value, { reviewId: id(99) });
      expect(initialFillProvenanceSchema.safeParse(value).success).toBe(false);
    });
  it.each([null, [], false, 'dependency'] as const)('rejects invalid protected dependency %s without throwing from refinements', dependencies => {
    expect(initialFillProvenanceSchema.safeParse({ ...protectedProvenance(), dependencies }).success).toBe(false);
  });
  it.each(['1.5', 'unknown', '-1'])('rejects malformed generation %s without a BigInt exception', targetGeneration => {
    const value = protectedProvenance(); value.authorized.targetGeneration = targetGeneration;
    expect(initialFillProvenanceSchema.safeParse(value).success).toBe(false);
  });
});
