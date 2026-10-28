import { describe, expect, it } from 'vitest';
import { preparationFixture, preparationIds } from '../src/test/preparationFixtures.js';
import { calculationGrantProvenanceSchema } from './pathfinderCalculationGrant.js';
import {
  preparationPartV1Schema, preparationPartV2Schema, preparationPartSchema,
  preparationPartReceiptV1Schema, preparationPartReceiptV2Schema, preparationPartReceiptSchema,
  preparationSessionV1Schema, preparationSessionV2Schema, preparationSessionSchema,
  preparationAggregateV1Schema, preparationAggregateV2Schema, preparationAggregateSchema,
  preparationPublicationV1Schema, preparationPublicationV2Schema, preparationPublicationSchema,
  preparationContextV1Schema, preparationContextV2Schema, preparationContextSchema,
} from './pathfinderPreparation.js';

const id = (n: number) => `f8100000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Synthetic transport examples only; no frozen engineering fixture or receipt is changed. */
function fixture() {
  const base = preparationFixture(), ids = preparationIds;
  const grant = calculationGrantProvenanceSchema.parse({ kind: 'calculation-grant', projectId: ids.project,
    grantId: id(1), grantRevision: '2', grantEpoch: '3', installationEpoch: id(4), issuerId: ids.actor, issuerAdminRevision: '5' });
  const partA = preparationPartV1Schema.parse(base.committed);
  const partB = preparationPartV2Schema.parse({ ...partA, schemaVersion: 'wfc.pf.preparation-part.v2',
    producer: { ...partA.producer, level: 'B', grant } });
  const sessionA = preparationSessionV1Schema.parse({ ...base.session, state: 'collecting', parts: [partA],
    coverage: { expectedParts: 1, committedParts: 1, requestedScopeComplete: true, missingPartIds: [] } });
  const sessionB = preparationSessionV2Schema.parse({ ...sessionA, schemaVersion: 'wfc.pf.preparation-session.v2',
    principal: { kind: 'calculation-grant', actorId: ids.actor, grant }, parts: [partB] });
  const aggregateA = preparationAggregateV1Schema.parse({ ...base.context.scope, schemaVersion: 'wfc.pf.geometry-aggregate.v1',
    id: id(6), projectId: ids.project, sessionId: ids.session, artifactId: id(7), geometryRevision: '1',
    sourceLocationRegistryRevision: base.context.scope.locationRegistryRevision, coordinateFrameId: base.session.plan.coordinateFrameId,
    orderedPlanSha256: base.session.plan.orderedPlanSha256, orderedScopeSha256: base.session.plan.requestedScope.scopeSha256,
    partReferences: [{ partId: partA.partId, partIndex: partA.partIndex, payloadSha256: partA.payloadSha256 }],
    projection: { schemaVersion: 'pathfinder.model.snapshot.v1', payloadRef: id(8), sha256: 'd'.repeat(64), bytes: 1 },
    traceIndex: { schemaVersion: 'wfc.pf.preparation-trace-index.v1', payloadRef: id(9), sha256: 'e'.repeat(64), bytes: 1 },
    counts: partA.counts, requestedScopeComplete: true, wholePlantGeometry: false, engineVersion: 'synthetic-unchanged-engine',
    rulesVersion: 'synthetic-unchanged-rules', diagnostics: [], engineeringAccepted: false, nativeParity: 'not-performed',
    publishedAt: '2026-10-19T00:00:01Z' });
  const aggregateB = preparationAggregateV2Schema.parse({ ...aggregateA, schemaVersion: 'wfc.pf.geometry-aggregate.v2', producerGrant: grant });
  const publicationA = { schemaVersion: 'wfc.pf.preparation-publication.v1', sessionId: ids.session, aggregate: aggregateA, duplicate: false };
  const publicationB = { ...publicationA, schemaVersion: 'wfc.pf.preparation-publication.v2', aggregate: aggregateB };
  const contextA = { ...base.context, currentAggregate: aggregateA };
  const contextB = { ...base.context, schemaVersion: 'wfc.pf.preparation-context.v2', currentAggregate: aggregateB };
  const receiptA = { schemaVersion: 'wfc.pf.preparation-part-receipt.v1', part: partA, sessionRevision: '2', duplicate: false };
  const receiptB = { ...receiptA, schemaVersion: 'wfc.pf.preparation-part-receipt.v2', part: partB };
  return { ...base, grant, partA, partB, sessionA, sessionB, aggregateA, aggregateB, publicationA, publicationB, contextA, contextB, receiptA, receiptB };
}

describe('explicit Level B preparation transport without widening historical Level A', () => {
  it('retains strict v1 examples and accepts explicit v2 variants through the shared readers', () => {
    const f = fixture();
    for (const [schema, value] of [
      [preparationPartV1Schema, f.partA], [preparationSessionV1Schema, f.sessionA],
      [preparationAggregateV1Schema, f.aggregateA], [preparationPublicationV1Schema, f.publicationA],
      [preparationContextV1Schema, f.contextA], [preparationPartReceiptV1Schema, f.receiptA],
      [preparationPartV2Schema, f.partB], [preparationSessionV2Schema, f.sessionB],
      [preparationAggregateV2Schema, f.aggregateB], [preparationPublicationV2Schema, f.publicationB],
      [preparationContextV2Schema, f.contextB], [preparationPartReceiptV2Schema, f.receiptB],
      [preparationPartSchema, f.partB], [preparationSessionSchema, f.sessionB],
      [preparationAggregateSchema, f.aggregateB], [preparationPublicationSchema, f.publicationB],
      [preparationContextSchema, f.contextB], [preparationPartReceiptSchema, f.receiptB],
    ] as const) expect(schema.safeParse(value).success).toBe(true);
  });

  it('refuses B content mislabeled with every historical v1 envelope', () => {
    const f = fixture();
    for (const [schema, value] of [
      [preparationPartSchema, { ...f.partB, schemaVersion: f.partA.schemaVersion }],
      [preparationSessionSchema, { ...f.sessionB, schemaVersion: f.sessionA.schemaVersion }],
      [preparationAggregateSchema, { ...f.aggregateB, schemaVersion: f.aggregateA.schemaVersion }],
      [preparationPublicationSchema, { ...f.publicationB, schemaVersion: f.publicationA.schemaVersion }],
      [preparationContextSchema, { ...f.contextB, schemaVersion: f.contextA.schemaVersion }],
      [preparationPartReceiptSchema, { ...f.receiptB, schemaVersion: f.receiptA.schemaVersion }],
    ] as const) expect(schema.safeParse(value).success).toBe(false);
  });

  it('never accepts a v1 part or aggregate nested inside a v2 B envelope', () => {
    const f = fixture();
    expect(preparationSessionSchema.safeParse({ ...f.sessionB, parts: [f.partA] }).success).toBe(false);
    expect(preparationPublicationSchema.safeParse({ ...f.publicationB, aggregate: f.aggregateA }).success).toBe(false);
    expect(preparationContextSchema.safeParse({ ...f.contextB, currentAggregate: f.aggregateA }).success).toBe(false);
    expect(preparationPartReceiptSchema.safeParse({ ...f.receiptB, part: f.partA }).success).toBe(false);
  });

  it.each(['grantId', 'grantRevision', 'grantEpoch', 'installationEpoch', 'issuerId', 'issuerAdminRevision'] as const)
  ('refuses a committed part from another original %s within a B session', key => {
    const f = fixture(), changed = key.endsWith('Revision') || key === 'grantEpoch' ? '99' : id(99);
    const part = { ...f.partB, producer: { ...f.partB.producer, grant: { ...f.grant, [key]: changed } } };
    expect(preparationSessionSchema.safeParse({ ...f.sessionB, parts: [part] }).success).toBe(false);
  });

  it('refuses a foreign-project grant on session and aggregate provenance', () => {
    const f = fixture(), foreignGrant = { ...f.grant, projectId: id(98) };
    const foreignPart = { ...f.partB, producer: { ...f.partB.producer, grant: foreignGrant } };
    expect(preparationSessionSchema.safeParse({ ...f.sessionB, principal: { ...f.sessionB.principal, grant: foreignGrant }, parts: [foreignPart] }).success).toBe(false);
    expect(preparationAggregateSchema.safeParse({ ...f.aggregateB, producerGrant: foreignGrant }).success).toBe(false);
  });

  it('retains a grant-bound validation recovery intent without a fabricated login', () => {
    const f = fixture(), recovery = { command: { schemaVersion: 'wfc.pf.preparation-mutation.v1', expectedSessionRevision: '1',
      idempotencyKey: id(30), reason: 'Synthetic recovery command' }, expiresAt: '2026-10-19T00:02:00Z',
      actorId: f.grant.issuerId, loginId: null, grant: f.grant };
    expect(preparationSessionSchema.safeParse({ ...f.sessionB, state: 'validating', recovery }).success).toBe(true);
    for (const changed of [{ ...recovery, loginId: preparationIds.login }, { ...recovery, actorId: id(31) },
      { ...recovery, grant: { ...f.grant, grantEpoch: '99' } }]) {
      expect(preparationSessionSchema.safeParse({ ...f.sessionB, state: 'validating', recovery: changed }).success).toBe(false);
    }
    expect(preparationSessionSchema.safeParse({ ...f.sessionB, state: 'validating', recovery: null }).success).toBe(false);
  });

  it('keeps engineering acceptance false and excludes execution secrets from versioned B records', () => {
    const f = fixture();
    expect(f.aggregateB.engineeringAccepted).toBe(false);
    expect(f.aggregateB.nativeParity).toBe('not-performed');
    expect(preparationAggregateSchema.safeParse({ ...f.aggregateB, engineeringAccepted: true }).success).toBe(false);
    expect(preparationSessionSchema.safeParse({ ...f.sessionB, principal: { ...f.sessionB.principal, loginId: preparationIds.login } }).success).toBe(false);
    expect(preparationAggregateSchema.safeParse({ ...f.aggregateB, producerGrant: { ...f.grant, ownerToken: 'a'.repeat(64) } }).success).toBe(false);
  });
});
